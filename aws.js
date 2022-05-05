const credentials = {
  "accessKeyId": "***REMOVED***",
  "secretAccessKey": "***REMOVED***",
};
const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const { broadcast } = require("./wss.js")

async function transcribeAudio(stream, id64) {
  const client = new TranscribeStreamingClient({
    region: "us-east-2",
    credentials
  });

  console.log("Starting stream for:", id64)

  const params = {
    LanguageCode: "en-US",
    MediaEncoding: "pcm",
    MediaSampleRateHertz: "24000",
    IdentifyLanguage: false,
    AudioStream: (async function* () {
      for await (const chunk of stream) {
        console.log("Yielding chunk")
        yield {AudioEvent: {AudioChunk: chunk}};
      }
    })(),
  };
  const command = new StartStreamTranscriptionCommand(params);
  // Send transcription request
  console.log("Sending transcription request")
  const response = await client.send(command);
  // Start to print response
  try {
    for await (const event of response.TranscriptResultStream) {
      const results = event.TranscriptEvent.Transcript.Results
      if (results.length > 0) {
        const result = results[0].Alternatives[0]
        const transcript = result.Transcript
        console.log(transcript)
        broadcast(`${id64}-${transcript}`)
      }
    }
  } catch(err) {
    console.log("error")
    console.log(err)
  }
  console.log("Transcription request closed")
}

module.exports.transcribeAudio = transcribeAudio
