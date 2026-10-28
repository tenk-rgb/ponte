namespace Ponte;

/// <summary>Saved group names, including empty groups, with compatibility for existing connection groups.</summary>
public static class ConnectionGroups
{
    static bool Same(string a, string b) => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    public static List<string> Names(AppData data) => data.Groups
        .Concat(data.Connections.Select(c => c.Group))
        .Select(g => g.Trim()).Where(g => g.Length > 0)
        .Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.CurrentCultureIgnoreCase).ToList();

    public static void Normalize(AppData data)
    {
        data.Groups = Names(data);
        foreach (var c in data.Connections)
            c.Group = data.Groups.FirstOrDefault(g => Same(g, c.Group)) ?? "";
    }

    public static void Save(AppData data, string originalName, string name, IEnumerable<string> connectionIds)
    {
        originalName = originalName.Trim();
        name = name.Trim();
        if (name.Length == 0) throw new InvalidOperationException("Digite um nome para o grupo.");
        var groups = Names(data);
        if (originalName.Length > 0 && !groups.Any(g => Same(g, originalName)))
            throw new InvalidOperationException("Este grupo não existe mais. Abra o formulário novamente.");
        if (groups.Any(g => Same(g, name) && (originalName.Length == 0 || !Same(g, originalName))))
            throw new InvalidOperationException("Já existe um grupo com esse nome.");
        var selected = connectionIds.ToHashSet(StringComparer.Ordinal);
        if (selected.Except(data.Connections.Select(c => c.Id)).Any())
            throw new InvalidOperationException("Uma conexão foi removida. Abra o formulário novamente.");

        // Validate everything before changing membership. Only the group field changes on a connection.
        groups.RemoveAll(g => originalName.Length > 0 && Same(g, originalName));
        groups.Add(name);
        data.Groups = groups;
        foreach (var c in data.Connections)
        {
            if (selected.Contains(c.Id)) c.Group = name;
            else if (originalName.Length > 0 && Same(c.Group, originalName)) c.Group = "";
        }
        Normalize(data);
    }
}
