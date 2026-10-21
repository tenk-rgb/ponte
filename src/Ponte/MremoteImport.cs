using System.Text;
using System.Xml.Linq;
using Org.BouncyCastle.Crypto.Engines;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Modes;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto;

namespace Ponte;

/// <summary>
/// Reads a legacy confCons.xml connections file (ConfVersion 2.6):
/// AES-GCM, PBKDF2-SHA1 key from the default password "mR3m", payload = salt(16) | nonce(16) | ciphertext+tag,
/// with the salt also used as associated data.
/// </summary>
public static class MremoteImport
{
    public static string DefaultPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "mRemoteNG", "confCons.xml");

    public static List<Connection> Read(string path, string masterPassword = "mR3m")
    {
        var doc = XDocument.Load(path);
        var root = doc.Root ?? throw new InvalidDataException("Arquivo vazio.");
        if ((string?)root.Attribute("FullFileEncryption") == "true")
            throw new InvalidDataException("Este arquivo está todo criptografado. No mRemoteNG, desative a criptografia completa e exporte de novo.");
        var iterations = int.TryParse((string?)root.Attribute("KdfIterations"), out var it) ? it : 1000;

        var result = new List<Connection>();
        Walk(root, "", result, masterPassword, iterations);
        return result;
    }

    static void Walk(XElement parent, string group, List<Connection> output, string pass, int iterations)
    {
        foreach (var node in parent.Elements().Where(e => e.Name.LocalName == "Node"))
        {
            var name = (string?)node.Attribute("Name") ?? "";
            if ((string?)node.Attribute("Type") == "Container")
            {
                Walk(node, string.IsNullOrEmpty(group) ? name : $"{group} / {name}", output, pass, iterations);
                continue;
            }
            var protocol = (string?)node.Attribute("Protocol") ?? "";
            var c = new Connection
            {
                Name = name,
                Host = (string?)node.Attribute("Hostname") ?? "",
                User = (string?)node.Attribute("Username") ?? "",
                Domain = (string?)node.Attribute("Domain") ?? "",
                Group = group,
            };
            int.TryParse((string?)node.Attribute("Port"), out var port);
            switch (protocol)
            {
                case "RDP":
                    c.Os = "windows"; c.Desktop = "rdp"; c.Ssh = false; if (port > 0) c.RdpPort = port; break;
                case "VNC":
                    c.Os = "linux"; c.Desktop = "vnc"; c.Ssh = false; if (port > 0) c.VncPort = port; break;
                case "SSH1" or "SSH2":
                    c.Os = "linux"; c.Desktop = "none"; c.Ssh = true; if (port > 0) c.SshPort = port; break;
                default:
                    continue;   // Telnet, HTTP, ICA... are left out of Ponte on purpose
            }
            var encrypted = (string?)node.Attribute("Password");
            if (!string.IsNullOrEmpty(encrypted))
            {
                var plain = TryDecrypt(encrypted, pass, iterations);
                if (plain is not null)
                {
                    if (c.Desktop == "vnc") c.VncSecret = Store.Protect(plain);
                    else c.Secret = Store.Protect(plain);
                }
            }
            output.Add(c);
        }
    }

    public static string? TryDecrypt(string base64, string password, int iterations)
    {
        try
        {
            var data = Convert.FromBase64String(base64);
            if (data.Length < 32 + 16) return null;
            var salt = data[..16];
            var nonce = data[16..32];
            var cipherText = data[32..];

            var gen = new Pkcs5S2ParametersGenerator();
            gen.Init(PbeParametersGenerator.Pkcs5PasswordToUtf8Bytes(password.ToCharArray()), salt, iterations);
            var key = (KeyParameter)gen.GenerateDerivedMacParameters(256);

            var gcm = new GcmBlockCipher(new AesEngine());
            gcm.Init(false, new AeadParameters(key, 128, nonce, salt));
            var output = new byte[gcm.GetOutputSize(cipherText.Length)];
            var len = gcm.ProcessBytes(cipherText, 0, cipherText.Length, output, 0);
            len += gcm.DoFinal(output, len);
            return Encoding.UTF8.GetString(output, 0, len);
        }
        catch (Exception ex) when (ex is InvalidCipherTextException or FormatException or ArgumentException)
        {
            return null;
        }
    }
}
