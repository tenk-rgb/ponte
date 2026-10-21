using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Ponte;

/// <summary>Looks for a newer release of Ponte on GitHub and installs it over the current copy.</summary>
public static class Updater
{
    const string Releases = "https://api.github.com/repos/tenk-rgb/ponte/releases?per_page=10";
    static readonly HttpClient Http = CreateClient();

    static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("Ponte-Updater");
        c.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return c;
    }

    /// <summary>The running version. PONTE_FAKE_VERSION lets a dev build pretend to be older, to test the flow.</summary>
    public static string Current =>
        Environment.GetEnvironmentVariable("PONTE_DEV") == "1" && Environment.GetEnvironmentVariable("PONTE_FAKE_VERSION") is { Length: > 0 } fake
            ? fake : Application.ProductVersion.Split('+')[0];

    public sealed record Info(string Version, string Name, string Notes, string Page, string? Asset, long Size);

    /// <summary>The newest published release if it is newer than the running copy; otherwise null.</summary>
    public static async Task<Info?> Check()
    {
        using var doc = JsonDocument.Parse(await Http.GetStringAsync(Releases));
        var current = Parse(Current) ?? new Version(0, 0, 0);
        Info? best = null;
        Version? bestVersion = null;
        foreach (var r in doc.RootElement.EnumerateArray())
        {
            if (r.GetProperty("draft").GetBoolean()) continue;
            var v = Parse(r.GetProperty("tag_name").GetString() ?? "");
            if (v is null || v <= current || (bestVersion is not null && v <= bestVersion)) continue;
            string? asset = null;
            long size = 0;
            foreach (var a in r.GetProperty("assets").EnumerateArray())
            {
                if (a.GetProperty("name").GetString() != "Ponte-Setup.exe") continue;
                asset = a.GetProperty("browser_download_url").GetString();
                size = a.GetProperty("size").GetInt64();
            }
            bestVersion = v;
            best = new Info(v.ToString(3), r.GetProperty("name").GetString() ?? v.ToString(3),
                r.GetProperty("body").GetString() ?? "", r.GetProperty("html_url").GetString() ?? "", asset, size);
        }
        return best;
    }

    static Version? Parse(string s)
    {
        var m = Regex.Match(s, @"(\d+)\.(\d+)\.(\d+)");
        return m.Success ? new Version(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value)) : null;
    }

    /// <summary>Downloads the installer, reporting 0–100, then starts it silently. The installer closes Ponte and reopens it.</summary>
    public static async Task<string> DownloadAndRun(string url, long size, Action<int> progress)
    {
        var path = Path.Combine(Path.GetTempPath(), "Ponte-Setup-update.exe");
        using (var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
        {
            resp.EnsureSuccessStatusCode();
            var total = resp.Content.Headers.ContentLength ?? size;
            await using var src = await resp.Content.ReadAsStreamAsync();
            await using var dst = File.Create(path);
            var buf = new byte[81920];
            long done = 0;
            int read, last = -1;
            while ((read = await src.ReadAsync(buf)) > 0)
            {
                await dst.WriteAsync(buf.AsMemory(0, read));
                done += read;
                var pct = total > 0 ? (int)(done * 100 / total) : 0;
                if (pct != last) { progress(pct); last = pct; }
            }
        }
        // PONTE_UPDATE_DRYRUN stops here, so the flow can be tested without replacing the installed copy.
        if (Environment.GetEnvironmentVariable("PONTE_UPDATE_DRYRUN") == "1") return path;
        // Start the installer with a clean environment: test switches must not reach the copy it reopens.
        var psi = new ProcessStartInfo(path, "/SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS") { UseShellExecute = false };
        foreach (var v in new[] { "PONTE_DEV", "PONTE_FAKE_VERSION", "PONTE_UPDATE_DRYRUN", "PONTE_OFFSCREEN", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS" })
            psi.Environment.Remove(v);
        Process.Start(psi);
        return path;
    }
}
