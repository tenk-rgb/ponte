using System.Text;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace Ponte.Sessions;

public static class Ssh
{
    /// <summary>Password, keyboard-interactive and key auth in one go, so servers that only allow one of them still work.</summary>
    public static ConnectionInfo Info(Connection c)
    {
        var (host, port) = SplitHost(c.Host, c.SshPort);
        var password = Store.Unprotect(c.Secret);
        var methods = new List<AuthenticationMethod>();
        if (!string.IsNullOrWhiteSpace(c.KeyPath) && File.Exists(c.KeyPath))
        {
            var key = string.IsNullOrEmpty(password) ? new PrivateKeyFile(c.KeyPath) : TryKey(c.KeyPath, password);
            methods.Add(new PrivateKeyAuthenticationMethod(c.User, key));
        }
        if (!string.IsNullOrEmpty(password))
        {
            methods.Add(new PasswordAuthenticationMethod(c.User, password));
            var kbd = new KeyboardInteractiveAuthenticationMethod(c.User);
            kbd.AuthenticationPrompt += (_, e) => { foreach (var p in e.Prompts) p.Response = password; };
            methods.Add(kbd);
        }
        if (methods.Count == 0) methods.Add(new NoneAuthenticationMethod(c.User));
        return new ConnectionInfo(host, port, c.User, methods.ToArray()) { Timeout = TimeSpan.FromSeconds(15) };
    }

    static PrivateKeyFile TryKey(string path, string pass)
    {
        try { return new PrivateKeyFile(path, pass); } catch { return new PrivateKeyFile(path); }
    }

    public static (string host, int port) SplitHost(string raw, int fallback)
    {
        raw = raw.Trim();
        var i = raw.LastIndexOf(':');
        if (i > 0 && raw.IndexOf(':') == i && int.TryParse(raw[(i + 1)..], out var p)) return (raw[..i], p);
        return (raw, fallback);
    }

    /// <summary>Trust on first use: remember the server key, refuse if it changes later.</summary>
    public static void TrustOnFirstUse(BaseClient client, Store store, string host, int port)
    {
        client.HostKeyReceived += (_, e) =>
        {
            var id = $"{host}:{port}";
            var fp = e.FingerPrintSHA256;
            lock (store)
            {
                if (!store.Data.KnownHosts.TryGetValue(id, out var known))
                {
                    store.Data.KnownHosts[id] = fp;
                    store.Save();
                    e.CanTrust = true;
                }
                else e.CanTrust = known == fp;
            }
        };
    }

    public static string Friendly(Exception ex) => ex switch
    {
        SshAuthenticationException => "Usuário ou senha não aceitos pelo servidor.",
        SshConnectionException { Message: var m } when m.Contains("Key exchange negotiation failed") || m.Contains("host key", StringComparison.OrdinalIgnoreCase)
            => "A chave do servidor mudou desde a última conexão. Se o servidor foi reinstalado, use Ajustes > Esquecer chaves salvas.",
        SshOperationTimeoutException => "O servidor não respondeu a tempo.",
        System.Net.Sockets.SocketException => "Não consegui alcançar o servidor. Confira o endereço e a porta.",
        _ => ex.Message,
    };
}

/// <summary>Interactive shell over SSH. Also runs remote agents: the command is typed once the shell is up.</summary>
public sealed class SshTerminal : Session
{
    SshClient? _client;
    ShellStream? _shell;

    public void Start(Connection c, Store store, int cols, int rows, string? startCommand)
    {
        Task.Run(() =>
        {
            try
            {
                var info = Ssh.Info(c);
                _client = new SshClient(info);
                Ssh.TrustOnFirstUse(_client, store, info.Host, info.Port);
                _client.KeepAliveInterval = TimeSpan.FromSeconds(30);
                _client.Connect();
                _shell = _client.CreateShellStream("xterm-256color", (uint)cols, (uint)rows, 0, 0, 1 << 16);
                var pump = new Utf8Pump(Send, Id);
                _shell.DataReceived += (_, e) => pump.Push(e.Data, e.Data.Length);
                _shell.Closed += (_, _) => Closed("Conexão encerrada.");
                _client.ErrorOccurred += (_, e) => Closed(Ssh.Friendly(e.Exception));
                if (!string.IsNullOrWhiteSpace(startCommand))
                {
                    _shell.WriteLine(startCommand);
                }
            }
            catch (Exception ex)
            {
                Send(new { t = "term.data", sid = Id, data = $"\r\n\x1b[31m{Ssh.Friendly(ex)}\x1b[0m\r\n" });
                Closed(Ssh.Friendly(ex));
            }
        });
    }

    public override void Input(string data)
    {
        try { _shell?.Write(Encoding.UTF8.GetBytes(data)); _shell?.Flush(); } catch { }
    }

    public override void Resize(int cols, int rows)
    {
        try { _shell?.ChangeWindowSize((uint)cols, (uint)rows, 0, 0); } catch { }
    }

    public override void Dispose()
    {
        try { _shell?.Dispose(); _client?.Dispose(); } catch { }
        base.Dispose();
    }
}

/// <summary>File manager channel for a connection. Opened lazily the first time the Files view is shown.</summary>
public sealed class Sftp(Connection conn, Store store) : IDisposable
{
    SftpClient? _client;
    readonly SemaphoreSlim _gate = new(1, 1);

    async Task<SftpClient> Client()
    {
        if (_client is { IsConnected: true }) return _client;
        var info = Ssh.Info(conn);
        _client?.Dispose();
        _client = new SftpClient(info) { KeepAliveInterval = TimeSpan.FromSeconds(30) };
        Ssh.TrustOnFirstUse(_client, store, info.Host, info.Port);
        await _client.ConnectAsync(CancellationToken.None);
        return _client;
    }

    public async Task<T> Run<T>(Func<SftpClient, Task<T>> op)
    {
        await _gate.WaitAsync();
        try { return await op(await Client()); }
        finally { _gate.Release(); }
    }

    public Task<object> List(string path) => Run<object>(async c =>
    {
        if (!string.IsNullOrEmpty(path) && path != "~") c.ChangeDirectory(path);   // resolves "..", links and relative paths
        path = c.WorkingDirectory;
        var items = new List<object>();
        await foreach (var f in c.ListDirectoryAsync(path, CancellationToken.None))
        {
            if (f.Name is "." or "..") continue;
            items.Add(new
            {
                name = f.Name,
                dir = f.IsDirectory || (f.IsSymbolicLink && IsDir(c, f.FullName)),
                link = f.IsSymbolicLink,
                size = f.Length,
                mtime = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds(),
                mode = f.Attributes.ToString(),
            });
        }
        return new { path, items };
    });

    static bool IsDir(SftpClient c, string p)
    {
        try { return c.GetAttributes(p).IsDirectory; } catch { return false; }
    }

    public Task<string> Download(string remote, string local) => Run(async c =>
    {
        await using var fs = File.Create(local);
        await Task.Run(() => c.DownloadFile(remote, fs));
        return local;
    });

    public Task<int> Upload(IEnumerable<string> locals, string remoteDir) => Run(async c =>
    {
        var n = 0;
        foreach (var path in locals)
        {
            if (Directory.Exists(path)) { await UploadDir(c, path, remoteDir); n++; continue; }
            await using var fs = File.OpenRead(path);
            await Task.Run(() => c.UploadFile(fs, Join(remoteDir, Path.GetFileName(path)), true));
            n++;
        }
        return n;
    });

    static async Task UploadDir(SftpClient c, string local, string remoteDir)
    {
        var target = Join(remoteDir, Path.GetFileName(local.TrimEnd('\\')));
        if (!c.Exists(target)) c.CreateDirectory(target);
        foreach (var f in Directory.GetFiles(local))
        {
            await using var fs = File.OpenRead(f);
            await Task.Run(() => c.UploadFile(fs, Join(target, Path.GetFileName(f)), true));
        }
        foreach (var d in Directory.GetDirectories(local)) await UploadDir(c, d, target);
    }

    public Task<bool> Mkdir(string path) => Run(c => { c.CreateDirectory(path); return Task.FromResult(true); });
    public Task<bool> Rename(string from, string to) => Run(c => { c.RenameFile(from, to); return Task.FromResult(true); });

    public Task<bool> Delete(string path) => Run(c =>
    {
        DeleteRecursive(c, path);
        return Task.FromResult(true);
    });

    static void DeleteRecursive(SftpClient c, string path)
    {
        var attrs = c.GetAttributes(path);
        if (!attrs.IsDirectory || attrs.IsSymbolicLink) { c.DeleteFile(path); return; }
        foreach (var f in c.ListDirectory(path))
        {
            if (f.Name is "." or "..") continue;
            DeleteRecursive(c, f.FullName);
        }
        c.DeleteDirectory(path);
    }

    public static string Join(string dir, string name) => dir.EndsWith('/') ? dir + name : dir + "/" + name;

    public void Dispose() => _client?.Dispose();
}
