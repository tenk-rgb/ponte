using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Ponte.Sessions;

namespace Ponte;

public sealed class MainForm : Form
{
    readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    readonly Store _store = new();
    readonly Dictionary<string, Session> _sessions = [];
    readonly Dictionary<string, Sftp> _sftp = [];
    readonly Voice _voice = new();
    VncBridge? _vnc;

    public MainForm()
    {
        Text = "Ponte";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        MinimumSize = new Size(760, 480);
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1360, 860);
        BackColor = IsDark ? Color.FromArgb(17, 17, 19) : Color.FromArgb(250, 250, 249);
        Controls.Add(_web);
        _store.Load();
    }

    static bool IsDark =>
        Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme", 1) is 0;

    protected override async void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var dark = IsDark ? 1 : 0;
        DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));

        var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Ponte", "WebView2");
        var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
        await _web.EnsureCoreWebView2Async(env);
        var core = _web.CoreWebView2;
        var dev = Environment.GetEnvironmentVariable("PONTE_DEV") == "1";
        core.Settings.AreDevToolsEnabled = dev;
        core.Settings.AreDefaultContextMenusEnabled = dev;
        core.Settings.AreBrowserAcceleratorKeysEnabled = dev;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.SetVirtualHostNameToFolderMapping("app.ponte", Path.Combine(AppContext.BaseDirectory, "wwwroot"),
            CoreWebView2HostResourceAccessKind.Deny);
        core.WebMessageReceived += OnMessage;
        core.NewWindowRequested += (_, a) => { a.Handled = true; Process.Start(new ProcessStartInfo(a.Uri) { UseShellExecute = true }); };
        core.PermissionRequested += (_, a) => a.State = a.PermissionKind == CoreWebView2PermissionKind.ClipboardRead
            ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Default;
        core.Navigate("https://app.ponte/index.html");
    }

    // ---------- messaging ----------

    void Post(object message)
    {
        if (IsDisposed) return;
        if (InvokeRequired) { try { BeginInvoke(() => Post(message)); } catch { } return; }
        try { _web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, Store.Json)); } catch { }
    }

    void Reply(JsonElement m, object? data = null) =>
        Post(new { t = "reply", id = Str(m, "id"), ok = true, data });

    void Fail(JsonElement m, string error) =>
        Post(new { t = "reply", id = Str(m, "id"), ok = false, error });

    static string Str(JsonElement m, string name) =>
        m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";

    static int Int(JsonElement m, string name, int fallback = 0) =>
        m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? (int)Math.Round(v.GetDouble()) : fallback;

    static bool Bool(JsonElement m, string name) =>
        m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        JsonElement m;
        try { m = JsonDocument.Parse(args.WebMessageAsJson).RootElement; } catch { return; }
        try { await Dispatch(Str(m, "t"), m, args); }
        catch (Exception ex) { Fail(m, ex is Renci.SshNet.Common.SshException or System.Net.Sockets.SocketException ? Ssh.Friendly(ex) : ex.Message); }
    }

    async Task Dispatch(string type, JsonElement m, CoreWebView2WebMessageReceivedEventArgs args)
    {
        switch (type)
        {
            case "ready":
                Reply(m, StateDto());
                break;

            // ----- connections & agents -----
            case "conn.save":
                Reply(m, SaveConnection(m.GetProperty("conn")));
                PushState();
                break;
            case "conn.delete":
                _store.Data.Connections.RemoveAll(c => c.Id == Str(m, "connId"));
                _store.Save(); Reply(m); PushState();
                break;
            case "agent.save":
                Reply(m, SaveAgent(m.GetProperty("agent")));
                PushState();
                break;
            case "agent.delete":
                _store.Data.Agents.RemoveAll(a => a.Id == Str(m, "agentId"));
                _store.Save(); Reply(m); PushState();
                break;

            // ----- sessions -----
            case "open.term":
                Reply(m, new { sid = OpenTerminal(m) });
                break;
            case "open.rdp":
                Reply(m, new { sid = OpenRdp(m) });
                break;
            case "open.vnc":
            {
                var c = Need(Str(m, "connId"));
                var (host, port) = Ssh.SplitHost(c.Host, c.VncPort);
                _vnc ??= new VncBridge();
                Touch(c);
                Reply(m, new { url = _vnc.Register(host, port), password = Store.Unprotect(c.VncSecret ?? c.Secret) });
                break;
            }
            case "term.input":
                if (_sessions.TryGetValue(Str(m, "sid"), out var si)) si.Input(Str(m, "data"));
                break;
            case "term.resize":
                if (_sessions.TryGetValue(Str(m, "sid"), out var sr)) sr.Resize(Int(m, "cols"), Int(m, "rows"));
                break;
            case "rdp.bounds":
                if (_sessions.TryGetValue(Str(m, "sid"), out var rs) && rs is RdpSession rdp)
                    rdp.SetBounds(new Rectangle(Int(m, "x"), Int(m, "y"), Int(m, "w"), Int(m, "h")), Bool(m, "visible"), DeviceDpi / 96f);
                break;
            case "rdp.focus":
                if (_sessions.TryGetValue(Str(m, "sid"), out var rf) && rf is RdpSession rdpf) rdpf.Focus();
                break;
            case "close":
                if (_sessions.Remove(Str(m, "sid"), out var sc)) sc.Dispose();
                break;

            // ----- files -----
            case "sftp.list":
                Reply(m, await Files(m).List(Str(m, "path")));
                break;
            case "sftp.download":
            {
                var remote = Str(m, "path");
                var local = UniquePath(Path.Combine(Downloads, remote.Split('/').Last()));
                Reply(m, new { local = await Files(m).Download(remote, local) });
                break;
            }
            case "sftp.upload":
            {
                using var dlg = new OpenFileDialog { Multiselect = true, Title = "Enviar arquivos" };
                if (dlg.ShowDialog(this) != DialogResult.OK) { Reply(m, new { count = 0 }); break; }
                Reply(m, new { count = await Files(m).Upload(dlg.FileNames, Str(m, "dir")) });
                break;
            }
            case "sftp.drop":
            {
                var paths = args.AdditionalObjects?.OfType<CoreWebView2File>().Select(f => f.Path).ToList() ?? [];
                Reply(m, new { count = paths.Count == 0 ? 0 : await Files(m).Upload(paths, Str(m, "dir")) });
                break;
            }
            case "sftp.mkdir":
                Reply(m, await Files(m).Mkdir(Str(m, "path")));
                break;
            case "sftp.rename":
                Reply(m, await Files(m).Rename(Str(m, "from"), Str(m, "to")));
                break;
            case "sftp.delete":
                Reply(m, await Files(m).Delete(Str(m, "path")));
                break;

            // ----- misc -----
            case "reveal":
            {
                var p = Str(m, "path");
                if (File.Exists(p)) Process.Start("explorer.exe", $"/select,\"{p}\"");
                Reply(m);
                break;
            }
            case "pick.key":
            {
                using var dlg = new OpenFileDialog { Title = "Escolha a chave SSH",
                    InitialDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh") };
                Reply(m, new { path = dlg.ShowDialog(this) == DialogResult.OK ? dlg.FileName : "" });
                break;
            }
            case "pick.dir":
            {
                using var dlg = new FolderBrowserDialog { Description = "Pasta onde o agente vai trabalhar", UseDescriptionForTitle = true };
                Reply(m, new { path = dlg.ShowDialog(this) == DialogResult.OK ? dlg.SelectedPath : "" });
                break;
            }
            case "import.mremoteng":
            {
                var path = MremoteImport.DefaultPath;
                if (!File.Exists(path) || Bool(m, "pick"))
                {
                    using var dlg = new OpenFileDialog { Title = "Arquivo de conexões do mRemoteNG", Filter = "confCons.xml|*.xml" };
                    if (dlg.ShowDialog(this) != DialogResult.OK) { Reply(m, new { count = 0 }); break; }
                    path = dlg.FileName;
                }
                var imported = MremoteImport.Read(path);
                _store.Data.Connections.AddRange(imported);
                _store.Save();
                Reply(m, new { count = imported.Count });
                PushState();
                break;
            }
            case "hostkey.forget":
                _store.Data.KnownHosts.Clear();
                _store.Save(); Reply(m);
                break;
            case "voice.listen":
                Reply(m, new { text = await _voice.Listen() });
                break;
            case "voice.stop":
                _voice.Stop(); Reply(m);
                break;
            case "open.url":
                Process.Start(new ProcessStartInfo(Str(m, "url")) { UseShellExecute = true });
                break;
        }
    }

    // ---------- sessions ----------

    string OpenTerminal(JsonElement m)
    {
        int cols = Int(m, "cols", 120), rows = Int(m, "rows", 32);
        var agent = _store.AgentById(Str(m, "agentId"));
        var connId = agent is { Target: not "local" } ? agent.Target : Str(m, "connId");

        if (!string.IsNullOrEmpty(connId))
        {
            var c = Need(connId);
            string? start = null;
            if (agent is not null)
                start = string.IsNullOrWhiteSpace(agent.Cwd) ? agent.Command : $"cd {ShQuote(agent.Cwd)} && {agent.Command}";
            var s = new SshTerminal { Kind = "term", Title = agent?.Name ?? c.Name, ConnId = c.Id, AgentId = agent?.Id, Send = Post };
            _sessions[s.Id] = s;
            Touch(c);
            s.Start(c, _store, cols, rows, start);
            return s.Id;
        }

        var command = agent?.Command ?? Str(m, "command");
        if (string.IsNullOrWhiteSpace(command)) command = "powershell -NoLogo";
        var t = new LocalTerminal { Kind = "term", Title = agent?.Name ?? "Terminal", AgentId = agent?.Id, Send = Post };
        _sessions[t.Id] = t;
        // cmd /k keeps the window open if the agent exits, so errors like "command not found" stay readable.
        t.Start($"cmd.exe /d /k {command}", agent?.Cwd ?? "", cols, rows);
        return t.Id;
    }

    string OpenRdp(JsonElement m)
    {
        var c = Need(Str(m, "connId"));
        var s = new RdpSession { Kind = "rdp", Title = c.Name, ConnId = c.Id, Send = Post };
        _sessions[s.Id] = s;
        Touch(c);
        try { s.Start(this, c, new Rectangle(Int(m, "x"), Int(m, "y"), Int(m, "w", 1280), Int(m, "h", 800)), DeviceDpi / 96f); }
        catch { _sessions.Remove(s.Id); s.Dispose(); throw; }
        return s.Id;
    }

    Sftp Files(JsonElement m)
    {
        var c = Need(Str(m, "connId"));
        if (!_sftp.TryGetValue(c.Id, out var f)) _sftp[c.Id] = f = new Sftp(c, _store);
        return f;
    }

    Connection Need(string id) => _store.Conn(id) ?? throw new InvalidOperationException("Conexão não encontrada.");

    void Touch(Connection c)
    {
        c.LastUsed = DateTime.UtcNow;
        _store.Save();
    }

    static string ShQuote(string s) => "'" + s.Replace("'", "'\\''") + "'";

    static string Downloads => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");

    static string UniquePath(string path)
    {
        if (!File.Exists(path)) return path;
        var dir = Path.GetDirectoryName(path)!;
        var name = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);
        for (var i = 2; ; i++)
        {
            var p = Path.Combine(dir, $"{name} ({i}){ext}");
            if (!File.Exists(p)) return p;
        }
    }

    // ---------- state ----------

    object StateDto() => new
    {
        connections = _store.Data.Connections.Select(c => new
        {
            c.Id, c.Name, c.Os, c.Host, c.User, c.Domain, c.KeyPath, c.Desktop, c.Ssh, c.SshPort, c.RdpPort, c.VncPort,
            c.Group, c.Color, c.RedirectDrives, c.RedirectClipboard, c.LastUsed,
            hasPassword = !string.IsNullOrEmpty(c.Secret),
            hasVncPassword = !string.IsNullOrEmpty(c.VncSecret),
        }),
        agents = _store.Data.Agents,
        mremoteng = File.Exists(MremoteImport.DefaultPath),
    };

    void PushState() => Post(new { t = "state", data = StateDto() });

    string SaveConnection(JsonElement j)
    {
        var id = Str(j, "id");
        var c = _store.Conn(id);
        if (c is null) { c = new Connection(); _store.Data.Connections.Add(c); }
        c.Name = Str(j, "name").Trim();
        c.Os = Str(j, "os") == "windows" ? "windows" : "linux";
        c.Host = Str(j, "host").Trim();
        c.User = Str(j, "user").Trim();
        c.Domain = Str(j, "domain").Trim();
        c.KeyPath = Str(j, "keyPath").Trim();
        c.Desktop = Str(j, "desktop") is "rdp" or "vnc" ? Str(j, "desktop") : "none";
        c.Ssh = Bool(j, "ssh");
        c.SshPort = Int(j, "sshPort", 22);
        c.RdpPort = Int(j, "rdpPort", 3389);
        c.VncPort = Int(j, "vncPort", 5900);
        c.Group = Str(j, "group").Trim();
        c.Color = Str(j, "color");
        c.RedirectDrives = Bool(j, "redirectDrives");
        c.RedirectClipboard = Bool(j, "redirectClipboard");
        if (j.TryGetProperty("password", out var p) && p.ValueKind == JsonValueKind.String) c.Secret = Store.Protect(p.GetString());
        if (j.TryGetProperty("vncPassword", out var vp) && vp.ValueKind == JsonValueKind.String) c.VncSecret = Store.Protect(vp.GetString());
        if (string.IsNullOrEmpty(c.Name)) c.Name = c.Host;
        _sftp.Remove(c.Id, out var old);
        old?.Dispose();
        _store.Save();
        return c.Id;
    }

    string SaveAgent(JsonElement j)
    {
        var a = _store.AgentById(Str(j, "id"));
        if (a is null) { a = new Agent(); _store.Data.Agents.Add(a); }
        a.Name = Str(j, "name").Trim();
        a.Command = Str(j, "command").Trim();
        a.Cwd = Str(j, "cwd").Trim();
        a.Target = string.IsNullOrEmpty(Str(j, "target")) ? "local" : Str(j, "target");
        if (string.IsNullOrEmpty(a.Name)) a.Name = a.Command;
        _store.Save();
        return a.Id;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        foreach (var s in _sessions.Values.ToList()) { try { s.Dispose(); } catch { } }
        foreach (var f in _sftp.Values) f.Dispose();
        _vnc?.Dispose();
        base.OnFormClosing(e);
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
