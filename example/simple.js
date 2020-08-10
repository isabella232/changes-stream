#!/usr/bin/env node

const ChangesStream = require('../')

const COUCH_URI = process.env.COUCH_URI || 'http://admin:admin@127.0.0.1:59840/changes_stream_db'
const SINCE_SEQ = process.env.SINCE_SEQ || 0

let STREAM = new ChangesStream({
  db: COUCH_URI,
  include_docs: true,
  since: SINCE_SEQ
})

function destroyStream () {
  STREAM && STREAM.destroy()
  STREAM = null
}

let changesProcessed = 0
let packagesProcessed = 0

// Handling 'readable' listeners is not implemented
// STREAM.on('readable', function () {
//   // // Will raise an error.
// })

STREAM.on('data', function (change) {
  changesProcessed++
  if (change && change.doc && change.doc.name) {
    console.log(change.doc.name)
    packagesProcessed++
  }
})

STREAM.on('pause', function () {
  console.log('detected a pause in the follower...')
  if (STREAM.readableFlowing === 'null') {
    console.log('CHANGES stream has no listener for consuming stream data (flowing === null)')
  } else if (STREAM.readableFlowing === false) {
    console.log('CHANGES stream has been halted (flowing === false)')
  } else {
    console.log(`CHANGES#readableFlowing === ${STREAM.readableFlowing}`)
  }
  console.log(` changes processed: ${changesProcessed}`)
  console.log(`packages processed: ${packagesProcessed}`)
  destroyStream()
  process.exit(1)
})

STREAM.on('end', function () {
  console.log('There will be no more data.')
  console.log(` changes processed: ${changesProcessed}`)
  console.log(`packages processed: ${packagesProcessed}`)
  destroyStream()
  process.exit(0)
})

process.on('SIGINT', function () {
  console.log('Detected SIGINT - probably a control-c exit - caling STREAM.destroy()')
  destroyStream()
  process.exit(2)
})

process.on('uncaughtException', function (e) {
  console.log('Uncaught Exception...')
  console.log(e.stack)
  destroyStream()
  process.exit(99)
})
