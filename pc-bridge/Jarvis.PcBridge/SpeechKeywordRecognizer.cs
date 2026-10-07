using Jarvis.PcBridge.Core;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;

namespace Jarvis.PcBridge;

// Speech SDK on-device keyword spotting: audio stays on the PC and the default microphone is
// opened only for one recognition, so pausing or turning the toggle off releases it.
public sealed class SpeechKeywordRecognizer(string modelPath) : IKeywordRecognizer
{
    private readonly KeywordRecognitionModel _model = KeywordRecognitionModel.FromFile(modelPath);

    public async Task<bool> RecognizeOnceAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var audio = AudioConfig.FromDefaultMicrophoneInput();
        using var recognizer = new KeywordRecognizer(audio);
        Task? stopping = null;
        KeywordRecognitionResult result;
        // Start first: a stop requested before recognition starts would leave the task unresolved.
        var recognizing = recognizer.RecognizeOnceAsync(_model);
        using (cancellationToken.Register(() => Volatile.Write(ref stopping, recognizer.StopRecognitionAsync())))
        {
            result = await recognizing.ConfigureAwait(false);
        }
        if (Volatile.Read(ref stopping) is { } stop)
        {
            try { await stop.ConfigureAwait(false); }
            catch { }
        }
        cancellationToken.ThrowIfCancellationRequested();
        return result.Reason == ResultReason.RecognizedKeyword;
    }

    public ValueTask DisposeAsync()
    {
        _model.Dispose();
        return ValueTask.CompletedTask;
    }
}
