const { OpusEncoder } = require("@discordjs/opus")
const dgram = require("dgram")
const server = dgram.createSocket("udp4")
const {Readable} = require("stream")
const fs = require("fs")
const { transcribeAudio } = require("./aws.js")

let encoders = {}

let createReadable = () => {
  let readable = new Readable()
  readable._read = () => {}
  return readable
}

let getEncoder = () => {
  return new OpusEncoder(24000, 1)
}

const opcodes = {
  OP_CODEC_OPUSPLC: 6,
  OP_SAMPLERATE: 11,
  OP_SILENCE: 0
}

let decodeOpusFrames = (buf, encoderState, id64) => {
  console.log("Decoding opus frames")
  const maxRead = buf.length
  let readPos = 0
  let frames = []

  let readable = encoderState.stream
  let encoder = encoderState.encoder

  while(readPos < maxRead - 4) {
    let len = buf.readUInt16LE(readPos)
    readPos += 2

    let seq = buf.readUInt16LE(readPos)
    readPos += 2

    if(!encoderState.seq) {
      encoderState.seq = seq
    }

    if(seq < encoderState.seq) {
      encoderState.encoder = getEncoder()
      encoderState.seq = 0
    }
    else if(encoderState.seq != seq) {
      encoderState.seq = seq

      let lostFrames = Math.min(seq - encoderState.seq, 16)

      for(let i = 0; i < lostFrames; i++) {
        frames.push(encoder.decodePacketloss())
      }
    }

    encoderState.seq++;

    if(len <= 0 || seq < 0 || readPos + len > maxRead) {
      console.log(`Invalid packet LEN: ${len}, SEQ: ${seq}`)
      fs.writeFileSync('pckt_corr.dat', buf)
      return
    }

    const data = buf.slice(readPos, readPos + len)
    readPos += len

    let decodedFrame = encoder.decode(data)

    frames.push(decodedFrame)
  }

  let decompressedData = Buffer.concat(frames)
  readable.push(decompressedData)
}

let processPckt = (buf) => {
  let readPos = 0

  let id64 = buf.readBigInt64LE(readPos)
  readPos += 8

  if(!encoders[id64]) {
    let reader = createReadable()
    transcribeAudio(reader, id64)
    encoders[id64] = {encoder: getEncoder(), stream: reader}
  }
  encoders[id64].time = Date.now()/1000

  const maxRead = buf.length - 4

  while(readPos < maxRead - 1) {
    let op = buf.readUInt8(readPos)
    readPos++

    switch(op) {
      case opcodes.OP_SAMPLERATE:
        let sampleRate = buf.readUInt16LE(readPos)
        readPos += 2
        break;
      case opcodes.OP_SILENCE:
        let samples = buf.readUInt16LE(readPos)
        readPos += 2;
        encoders[id64].stream.push(Buffer.alloc(samples*2))
        break;
      case opcodes.OP_CODEC_OPUSPLC:
        let dataLen = buf.readUInt16LE(readPos)
        readPos += 2;
        decodeOpusFrames(buf.slice(readPos, readPos + dataLen), encoders[id64], id64)
        readPos += dataLen
        break;
      default:
        console.log(`ERR: Unhandled opcode ${op}`)
        fs.writeFileSync('pckt_undl', buf)
        break;
    }
  }

}

let gcEncoders = () => {
  let curtime = Date.now()/1000
  Object.keys(encoders).forEach(function (k) {
    let encoderData = encoders[k]
    if(encoderData.time + 1 < curtime) {
      encoders[k].stream.destroy()
      delete encoders[k]
    }
  })
}
setInterval(gcEncoders, 250)

server.on('error', (err) => {
  console.log(`server error:\n${err.stack}`)
  server.close()
})

server.on('message', (msg, rinfo) => {
  try {
    processPckt(msg)
  } catch(e) {
    console.log(`Voice packet decode failed for ${rinfo.address}:${rinfo.port}`)
    console.log(e)
  }
})

server.on('listening', () => {
  const address = server.address()
  console.log(`UDP socket listening ${address.address}:${address.port}`)
})

server.bind(process.env.PORT || 4000)
process.on('unhandledRejection', err => { throw err })
