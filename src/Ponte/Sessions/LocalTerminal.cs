using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Ponte.Sessions;

/// <summary>A local console program (claude, codex, gemini, powershell...) running in a Windows pseudo console.</summary>
public sealed class LocalTerminal : Session
{
    IntPtr _pty;
    SafeFileHandle? _process;
    FileStream? _input;
    FileStream? _output;
    readonly object _gate = new();

    public void Start(string commandLine, string cwd, int cols, int rows)
    {
        if (!CreatePipe(out var inRead, out var inWrite, IntPtr.Zero, 0) ||
            !CreatePipe(out var outRead, out var outWrite, IntPtr.Zero, 0))
            throw new Win32Exception();

        var hr = CreatePseudoConsole(new Coord(cols, rows), inRead, outWrite, 0, out _pty);
        if (hr != 0) throw new Win32Exception(hr);
        inRead.Dispose();
        outWrite.Dispose();

        _input = new FileStream(inWrite, FileAccess.Write);
        _output = new FileStream(outRead, FileAccess.Read);

        var si = new StartupInfoEx { StartupInfo = { cb = Marshal.SizeOf<StartupInfoEx>() } };
        var size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        si.lpAttributeList = Marshal.AllocHGlobal(size);
        try
        {
            if (!InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, ref size)) throw new Win32Exception();
            if (!UpdateProcThreadAttribute(si.lpAttributeList, 0, (IntPtr)ProcThreadAttributePseudoConsole,
                    _pty, IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();

            var dir = string.IsNullOrWhiteSpace(cwd) || !Directory.Exists(cwd)
                ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) : cwd;
            var cmd = new StringBuilder(commandLine);
            if (!CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, false, ExtendedStartupInfoPresent,
                    IntPtr.Zero, dir, ref si, out var pi))
                throw new Win32Exception();
            CloseHandle(pi.hThread);
            _process = new SafeFileHandle(pi.hProcess, true);
        }
        finally
        {
            DeleteProcThreadAttributeList(si.lpAttributeList);
            Marshal.FreeHGlobal(si.lpAttributeList);
        }

        var pump = new Utf8Pump(Send, Id);
        new Thread(() =>
        {
            var buf = new byte[16384];
            try
            {
                int n;
                while ((n = _output.Read(buf, 0, buf.Length)) > 0) pump.Push(buf, n);
            }
            catch { }
        }) { IsBackground = true, Name = "pty-read" }.Start();

        new Thread(() =>
        {
            WaitForSingleObject(_process.DangerousGetHandle(), uint.MaxValue);
            GetExitCodeProcess(_process.DangerousGetHandle(), out var code);
            Thread.Sleep(150);   // let the last output drain before the console is torn down
            Closed(code == 0 ? "Terminou." : $"Saiu com código {code}.");
            ClosePty();
        }) { IsBackground = true, Name = "pty-wait" }.Start();
    }

    public override void Input(string data)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(data);
            _input?.Write(bytes);
            _input?.Flush();
        }
        catch { }
    }

    public override void Resize(int cols, int rows)
    {
        lock (_gate) if (_pty != IntPtr.Zero && cols > 0 && rows > 0) ResizePseudoConsole(_pty, new Coord(cols, rows));
    }

    void ClosePty()
    {
        lock (_gate)
        {
            if (_pty != IntPtr.Zero) { ClosePseudoConsole(_pty); _pty = IntPtr.Zero; }
        }
        _input?.Dispose();
    }

    public override void Dispose()
    {
        if (_process is { IsInvalid: false, IsClosed: false }) TerminateProcess(_process.DangerousGetHandle(), 1);
        ClosePty();
        base.Dispose();
    }

    // ---- Win32 ----
    const uint ExtendedStartupInfoPresent = 0x00080000;
    const int ProcThreadAttributePseudoConsole = 0x00020016;

    [StructLayout(LayoutKind.Sequential)]
    readonly struct Coord(int x, int y) { readonly short X = (short)x, Y = (short)y; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public int cb; public string? lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfoEx { public StartupInfo StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int CreatePseudoConsole(Coord size, SafeFileHandle hInput, SafeFileHandle hOutput, uint flags, out IntPtr phPC);
    [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr hPC, Coord size);
    [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr hPC);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe, IntPtr lpPipeAttributes, int nSize);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string? app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
        IntPtr env, string? cwd, ref StartupInfoEx si, out ProcessInformation pi);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
}
