/* eslint-env mocha */

const chai = require('chai')
chai.use(require('chai-http'))
const { expect } = chai
const ChangesStream = require('../')

describe('integration tests against registry', function () {
  const testTimeoutSecs = 30
  this.timeout(testTimeoutSecs * 1000)

  let changesSeen = 0
  let changesDocsWithNames = 0

  let stream = new ChangesStream({
    db: 'https://skimdb.npmjs.com/registry',
    include_docs: true,
    // we can reproduce pause/resume problems quickly from this sequence
    since: 7895113
  })

  afterEach(function () {
    stream && stream.destroy()
    stream = null

    console.log(`     changes seen: ${changesSeen}`)
    console.log(`change with names: ${changesDocsWithNames}`)
  })

  it("'data' listener can work", function (done) {
    const start = Date.now()
    stream.on('error', function (err) {
      console.log(err, err.stack)
      expect.fail('listener should not receive an error')
      process.exit(1)
    })

    stream.on('data', function (change) {
      changesSeen++
      if (change && change.doc && change.doc.name) {
        changesDocsWithNames++
      }

      if (Date.now() > (start + ((testTimeoutSecs - 10) * 1000))) {
        // The performance range is staggering across multiple runs.
        // 7 < docs with names < 1200
        // The real test is that we see at least a few docs and we don't ever
        // see a pause.  See the on 'pause' below.
        expect(changesDocsWithNames).to.be.above(10)
        // Teardown the stream now because this function can be re-entered
        // Re-entry causes a chai error - multiple calls to done()
        stream.destroy()
        stream = null
        done()
      }
    })

    // This is a test. We should never see a pause.
    stream.on('pause', function () {
      if (stream) {
        const flowing = stream.readableFlowing
        if (flowing === 'null') {
          console.log('stream has no listener for consuming stream data (flowing === null)')
        } else if (flowing === false) {
          console.log('stream has been halted (flowing === false)')
        } else {
          console.log(`stream#reaableFlowing === ${flowing}`)
        }
        expect.fail('the stream should not pause because there is no back pressure')
        // Teardown the stream now because this function can be re-entered
        // Re-entry causes a chai error - multiple calls to done()
        stream.destroy()
        stream = null
        done()
      } else {
        console.log('stream was paused, but the stream has been destroyed; this is the correct behavior')
      }
    })
  })
})
