using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;

namespace Ponte.Sessions;

/// <summary>
/// Loopback WebSocket server that lets noVNC (in the web UI) reach a VNC server over plain TCP.
/// Each session gets a one-time token, so only the page that asked for it can use the tunnel.
/// </summary>
public sealed class VncBridge : IDisposable
{
    readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    readonly ConcurrentDictionary<string, (string host, int port)> _targets = new();
    readonly CancellationTokenSource _cts = new();

    public int Port { get; }

    public VncBridge()
    {
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = AcceptLoop();
    }

    public string Register(string host, int port)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        _targets[token] = (host, port);
        return $"ws://127.0.0.1:{Port}/{token}";
    }

    async Task AcceptLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(_cts.Token); }
            catch { return; }
            _ = Handle(client);
        }
    }

    async Task Handle(TcpClient client)
    {
        using var _ = client;
        var stream = client.GetStream();
        var header = await ReadHeader(stream);
        if (header is null) return;
        var lines = header.Split("\r\n");
        var path = lines[0].Split(' ').ElementAtOrDefault(1)?.TrimStart('/') ?? "";
        var headers = lines.Skip(1).Select(l => l.Split(':', 2)).Where(p => p.Length == 2)
            .ToDictionary(p => p[0].Trim().ToLowerInvariant(), p => p[1].Trim());

        if (!_targets.TryRemove(path, out var target) || !headers.TryGetValue("sec-websocket-key", out var key))
        {
            await stream.WriteAsync("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"u8.ToArray());
            return;
        }

        var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        string? proto = headers.TryGetValue("sec-websocket-protocol", out var p0) ? p0.Split(',')[0].Trim() : null;
        var response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                       $"Sec-WebSocket-Accept: {accept}\r\n" + (proto is null ? "" : $"Sec-WebSocket-Protocol: {proto}\r\n") + "\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(response));

        using var ws = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions
        {
            IsServer = true, SubProtocol = proto, KeepAliveInterval = TimeSpan.FromSeconds(20),
        });

        using var vnc = new TcpClient();
        try { await vnc.ConnectAsync(target.host, target.port, _cts.Token); }
        catch
        {
            await ws.CloseAsync(WebSocketCloseStatus.EndpointUnavailable, "unreachable", CancellationToken.None);
            return;
        }
        var tcp = vnc.GetStream();

        var up = Task.Run(async () =>
        {
            var buf = new byte[65536];
            while (ws.State == WebSocketState.Open)
            {
                var r = await ws.ReceiveAsync(buf, _cts.Token);
                if (r.MessageType == WebSocketMessageType.Close) break;
                await tcp.WriteAsync(buf.AsMemory(0, r.Count), _cts.Token);
            }
        });
        var down = Task.Run(async () =>
        {
            var buf = new byte[65536];
            int n;
            while ((n = await tcp.ReadAsync(buf, _cts.Token)) > 0)
                await ws.SendAsync(buf.AsMemory(0, n), WebSocketMessageType.Binary, true, _cts.Token);
        });
        try { await Task.WhenAny(up, down); } catch { }
        try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { }
    }

    static async Task<string?> ReadHeader(NetworkStream s)
    {
        var buf = new List<byte>();
        var one = new byte[1];
        while (buf.Count < 16384)
        {
            if (await s.ReadAsync(one) == 0) return null;
            buf.Add(one[0]);
            var n = buf.Count;
            if (n >= 4 && buf[n - 4] == '\r' && buf[n - 3] == '\n' && buf[n - 2] == '\r' && buf[n - 1] == '\n')
                return Encoding.ASCII.GetString(buf.ToArray());
        }
        return null;
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Stop();
    }
}
