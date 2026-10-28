namespace Ponte;

/// <summary>One saved machine. Everything a connection needs fits on one small form.</summary>
public sealed class Connection
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");
    public string Name { get; set; } = "";
    public string Os { get; set; } = "linux";          // windows | linux
    public string Host { get; set; } = "";
    public string User { get; set; } = "";
    public string Domain { get; set; } = "";
    public string? Secret { get; set; }                 // DPAPI-protected password
    public string KeyPath { get; set; } = "";           // optional SSH private key
    public string Desktop { get; set; } = "rdp";        // rdp | vnc | none
    public bool Ssh { get; set; } = true;
    public int SshPort { get; set; } = 22;
    public int RdpPort { get; set; } = 3389;
    public int VncPort { get; set; } = 5900;
    public string? VncSecret { get; set; }
    public string Group { get; set; } = "";
    public string Color { get; set; } = "";
    public bool RedirectDrives { get; set; }
    public bool RedirectClipboard { get; set; } = true;
    public DateTime? LastUsed { get; set; }
}

/// <summary>An AI agent or any long-running CLI, local or on a Linux connection.</summary>
public sealed class Agent
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");
    public string Name { get; set; } = "";
    public string Command { get; set; } = "claude";
    public string Cwd { get; set; } = "";
    public string Target { get; set; } = "local";       // "local" or a connection id
}

public sealed class AppData
{
    public List<string> Groups { get; set; } = [];
    public List<Connection> Connections { get; set; } = [];
    public List<Agent> Agents { get; set; } = [];
    public Dictionary<string, string> KnownHosts { get; set; } = [];
}
