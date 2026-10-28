using System.Runtime.InteropServices;

namespace Ponte.Sessions;

/// <summary>
/// Hosts the Windows Remote Desktop ActiveX control (the same component mstsc.exe uses).
/// Works for Windows hosts and for Linux hosts running xrdp. Late-bound, so no interop assembly is needed.
/// </summary>
sealed class RdpControl(string clsid) : AxHost(clsid)
{
    public dynamic Ocx => GetOcx() ?? throw new InvalidOperationException("RDP control not created");
    public object RawOcx => GetOcx()!;
}

[ComImport, Guid("C1E6743A-41C1-4A74-832A-0DD06C1C7A0E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMsTscNonScriptable
{
    void put_ClearTextPassword([MarshalAs(UnmanagedType.BStr)] string value);
}

public sealed class RdpSession : Session
{
    // Newest first; the first one Windows can create wins.
    static readonly string[] Clsids =
    [
        "3F859AA3-C2D4-4FAA-B0E4-FD0C9C4E5E3A", // v13
        "1DF7C823-B2D4-4B54-975A-F2AC5D7CF8B8", // v12
        "A0C63C30-F08D-4AB4-907C-34905D770C7D", // v11
        "8B918B82-7985-4C24-89DF-C33AD2BBFBCD", // v10
    ];

    RdpControl? _ax;
    System.Windows.Forms.Timer? _poll;
    System.Windows.Forms.Timer? _resizeDebounce;
    int _lastState = -1;
    bool _wasConnected;
    Size _pendingSize;

    public Control? View => _ax;

    public void Start(Form host, Connection c, Rectangle bounds, float dpiScale)
    {
        Exception? last = null;
        foreach (var id in Clsids)
        {
            try
            {
                var ax = new RdpControl("{" + id + "}") { Visible = false, Bounds = bounds };
                host.Controls.Add(ax);
                ax.CreateControl();
                _ = ax.Handle;          // invisible controls skip handle creation, and the ActiveX lives with the handle
                _ = ax.Ocx.Version;
                _ax = ax;
                break;
            }
            catch (Exception ex) { last = ex; }
        }
        if (_ax is null)
            throw new InvalidOperationException($"O componente de Área de Trabalho Remota do Windows não abriu. ({last?.GetType().Name}: {last?.Message})", last);
        _ax.BringToFront();

        var (server, port) = Ssh.SplitHost(c.Host, c.RdpPort);
        var ocx = _ax.Ocx;
        ocx.Server = server;
        ocx.UserName = c.User;
        if (!string.IsNullOrEmpty(c.Domain)) ocx.Domain = c.Domain;
        ocx.DesktopWidth = Math.Max(640, bounds.Width);
        ocx.DesktopHeight = Math.Max(480, bounds.Height);
        ocx.ColorDepth = 32;

        // Route Windows shortcuts (Alt+Tab, Windows key, etc.) to the focused remote
        // desktop even in windowed mode. This must be set before Connect().
        ocx.SecuredSettings2.KeyboardHookMode = 1;

        var adv = ocx.AdvancedSettings9;
        adv.RDPPort = port;
        adv.EnableCredSspSupport = true;
        adv.AuthenticationLevel = 2;         // warn on certificate problems instead of failing silently
        adv.RedirectClipboard = c.RedirectClipboard;
        adv.RedirectDrives = c.RedirectDrives;
        adv.EnableAutoReconnect = true;
        adv.BitmapPersistence = 1;
        adv.allowBackgroundInput = 1;
        adv.SmartSizing = false;
        adv.ContainerHandledFullScreen = 1;

        var password = Store.Unprotect(c.Secret);
        if (!string.IsNullOrEmpty(password))
        {
            try { ((IMsTscNonScriptable)_ax.RawOcx).put_ClearTextPassword(password); }
            catch { /* Windows will ask for the password instead */ }
        }

        ocx.Connect();

        _poll = new System.Windows.Forms.Timer { Interval = 700 };
        _poll.Tick += (_, _) => Poll(dpiScale);
        _poll.Start();
        _resizeDebounce = new System.Windows.Forms.Timer { Interval = 450 };
        _resizeDebounce.Tick += (_, _) => { _resizeDebounce.Stop(); ApplySize(dpiScale); };
    }

    void Poll(float dpiScale)
    {
        if (_ax is null) return;
        int state;
        try { state = (int)_ax.Ocx.Connected; } catch { state = 0; }
        if (state == _lastState) return;
        _lastState = state;
        if (state == 1)
        {
            _wasConnected = true;
            Send(new { t = "status", sid = Id, text = "" });
            ApplySize(dpiScale);
        }
        else if (state == 2) Send(new { t = "status", sid = Id, text = "Conectando…" });
        else
        {
            _poll?.Stop();
            Closed(_wasConnected ? "Sessão encerrada." : "Não foi possível conectar. Confira endereço, usuário e senha.");
        }
    }

    public void SetBounds(Rectangle r, bool visible, float dpiScale)
    {
        if (_ax is null) return;
        _ax.Visible = visible && r.Width > 10 && r.Height > 10;
        if (!_ax.Visible) return;
        if (_ax.Bounds != r)
        {
            _ax.Bounds = r;
            _pendingSize = r.Size;
            _resizeDebounce?.Stop();
            _resizeDebounce?.Start();
        }
        _ax.BringToFront();
    }

    public void Focus() => _ax?.Focus();

    void ApplySize(float dpiScale)
    {
        if (_ax is null || _lastState != 1) return;
        var s = _pendingSize.IsEmpty ? _ax.Size : _pendingSize;
        var scale = (uint)(Math.Round(dpiScale * 4) / 4 * 100);   // 100, 125, 150...
        try { _ax.Ocx.UpdateSessionDisplaySettings((uint)s.Width, (uint)s.Height, (uint)s.Width, (uint)s.Height, 0u, scale, 100u); }
        catch { }
    }

    public override void Dispose()
    {
        _poll?.Stop();
        _resizeDebounce?.Stop();
        if (_ax is not null)
        {
            try { if ((int)_ax.Ocx.Connected != 0) _ax.Ocx.Disconnect(); } catch { }
            _ax.Parent?.Controls.Remove(_ax);
            _ax.Dispose();
            _ax = null;
        }
        base.Dispose();
    }
}
