using Windows.Media.SpeechRecognition;

namespace Ponte;

/// <summary>Push-to-talk dictation through Windows speech recognition. One utterance per press.</summary>
public sealed class Voice
{
    SpeechRecognizer? _rec;

    async Task<SpeechRecognizer> Recognizer()
    {
        if (_rec is not null) return _rec;
        SpeechRecognizer rec;
        try { rec = new SpeechRecognizer(new Windows.Globalization.Language("pt-BR")); }
        catch { rec = new SpeechRecognizer(); }
        rec.Timeouts.InitialSilenceTimeout = TimeSpan.FromSeconds(6);
        rec.Timeouts.EndSilenceTimeout = TimeSpan.FromSeconds(1.2);
        var compiled = await rec.CompileConstraintsAsync();
        if (compiled.Status != SpeechRecognitionResultStatus.Success)
            throw new InvalidOperationException(compiled.Status.ToString());
        return _rec = rec;
    }

    public async Task<string> Listen()
    {
        try
        {
            var rec = await Recognizer();
            var result = await rec.RecognizeAsync();
            return result.Status == SpeechRecognitionResultStatus.Success ? result.Text : "";
        }
        catch (Exception ex) when ((uint)ex.HResult == 0x80045509)
        {
            throw new InvalidOperationException("Ative \"Reconhecimento de fala online\" em Configurações > Privacidade > Fala.");
        }
        catch (UnauthorizedAccessException)
        {
            throw new InvalidOperationException("O Windows bloqueou o microfone. Libere em Configurações > Privacidade > Microfone.");
        }
    }

    public void Stop()
    {
        try { _ = _rec?.StopRecognitionAsync(); } catch { }
    }
}
