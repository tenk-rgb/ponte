using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Ponte;

/// <summary>JSON file in %APPDATA%\Ponte. Secrets are DPAPI-encrypted for the current Windows user.</summary>
public sealed class Store
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    readonly string _dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        Environment.GetEnvironmentVariable("PONTE_OFFSCREEN") == "1" ? "Ponte-test" : "Ponte");
    string FilePath => Path.Combine(_dir, "data.json");
    readonly object _lock = new();

    public AppData Data { get; private set; } = new();

    public void Load()
    {
        Directory.CreateDirectory(_dir);
        if (!File.Exists(FilePath)) return;
        try { Data = JsonSerializer.Deserialize<AppData>(File.ReadAllText(FilePath), Json) ?? new(); }
        catch
        {
            File.Copy(FilePath, FilePath + ".broken", overwrite: true);
            Data = new();
        }
        ConnectionGroups.Normalize(Data);
    }

    public void Save()
    {
        lock (_lock)
        {
            ConnectionGroups.Normalize(Data);
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(Data, Json));
            File.Move(tmp, FilePath, overwrite: true);
        }
    }

    public Connection? Conn(string id) => Data.Connections.FirstOrDefault(c => c.Id == id);
    public Agent? AgentById(string id) => Data.Agents.FirstOrDefault(a => a.Id == id);

    public static string? Protect(string? plain)
    {
        if (string.IsNullOrEmpty(plain)) return null;
        var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), null, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(bytes);
    }

    public static string Unprotect(string? cipher)
    {
        if (string.IsNullOrEmpty(cipher)) return "";
        try
        {
            var bytes = ProtectedData.Unprotect(Convert.FromBase64String(cipher), null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch { return ""; }
    }
}
