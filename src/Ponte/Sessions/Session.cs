using System.Text;

namespace Ponte.Sessions;

/// <summary>Sends a message to the web UI. Safe to call from any thread.</summary>
public delegate void Send(object message);

public abstract class Session : IDisposable
{
    public string Id { get; } = Guid.NewGuid().ToString("n")[..12];
    public required string Kind { get; init; }          // term | rdp | vnc
    public required string Title { get; init; }
    public string? ConnId { get; init; }
    public string? AgentId { get; init; }
    public required Send Send { protected get; init; }

    bool _closed;

    public virtual void Input(string data) { }
    public virtual void Resize(int cols, int rows) { }

    protected void Closed(string reason)
    {
        if (_closed) return;
        _closed = true;
        Send(new { t = "session.closed", sid = Id, reason });
    }

    public virtual void Dispose() => Closed("");
}

/// <summary>Turns a byte stream into UTF-8 text without breaking multi-byte characters at chunk edges.</summary>
public sealed class Utf8Pump(Send send, string sid)
{
    readonly Decoder _decoder = new UTF8Encoding(false).GetDecoder();
    readonly object _lock = new();

    public void Push(byte[] buffer, int count)
    {
        string text;
        lock (_lock)
        {
            var chars = new char[_decoder.GetCharCount(buffer, 0, count)];
            _decoder.GetChars(buffer, 0, count, chars, 0);
            text = new string(chars);
        }
        if (text.Length > 0) send(new { t = "term.data", sid, data = text });
    }
}
