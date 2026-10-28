using System.Text.Json;
using Ponte;

static void Check(bool passed, string message)
{
    if (!passed) throw new Exception(message);
    Console.WriteLine($"PASS: {message}");
}
static void Reject(Action action, AppData data, string message)
{
    var before = JsonSerializer.Serialize(data);
    try { action(); }
    catch (InvalidOperationException)
    {
        Check(JsonSerializer.Serialize(data) == before, message);
        return;
    }
    throw new Exception($"Expected rejection: {message}");
}

// Backups written before saved groups existed must still populate the group list.
var data = JsonSerializer.Deserialize<AppData>("""
{"Connections":[{"Id":"a","Name":"Servidor A","Group":" Casa ","Secret":"encrypted-password","Host":"192.0.2.1"},{"Id":"b","Name":"Servidor B","Group":"casa"},{"Id":"c","Name":"Servidor C","Group":"Clientes"}]}
""")!;
ConnectionGroups.Normalize(data);
Check(data.Groups.Count == 2 && data.Connections[0].Group == data.Connections[1].Group, "legacy groups migrate and normalize without duplicates");
ConnectionGroups.Save(data, "", " Vazio ", []);
Check(data.Groups.Contains("Vazio"), "an empty group can be created");
var restored = JsonSerializer.Deserialize<AppData>(JsonSerializer.Serialize(data))!;
ConnectionGroups.Normalize(restored);
Check(restored.Groups.Contains("Vazio"), "empty groups survive backup and reload");
ConnectionGroups.Save(data, "Casa", "Escritório", ["a", "b"]);
Check(data.Connections.Take(2).All(c => c.Group == "Escritório") && !data.Groups.Contains("Casa"), "renaming updates every member");
Check(data.Connections[0].Secret == "encrypted-password" && data.Connections[0].Host == "192.0.2.1", "renaming preserves credentials and connection details");
Reject(() => ConnectionGroups.Save(data, "Escritório", "clientes", ["a"]), data, "duplicate names fail without changing data");
Reject(() => ConnectionGroups.Save(data, "", "   ", []), data, "empty names fail without changing data");
Reject(() => ConnectionGroups.Save(data, "Missing", "Outra", []), data, "stale groups fail without changing data");
Reject(() => ConnectionGroups.Save(data, "Escritório", "Outra", ["removed-id"]), data, "stale connections fail without changing data");
ConnectionGroups.Save(data, "Escritório", "ESCRITÓRIO", ["a", "c"]);
Check(data.Connections.Single(c => c.Id == "a").Group == "ESCRITÓRIO" && data.Connections.Single(c => c.Id == "c").Group == "ESCRITÓRIO", "members can move from other groups while changing case");
Check(data.Connections.Single(c => c.Id == "b").Group == "" && data.Groups.Contains("Clientes"), "deselected members become ungrouped and their old groups persist");
ConnectionGroups.Save(data, "ESCRITÓRIO", "ESCRITÓRIO", []);
Check(data.Groups.Contains("ESCRITÓRIO") && data.Connections.All(c => c.Group == ""), "removing every member keeps the group");
Console.WriteLine("All group regression checks passed.");
