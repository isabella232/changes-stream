/* eslint-env mocha */

const chai = require('chai')
chai.use(require('chai-http'))
const { expect } = chai
const ChangesStream = require('../')

const COUCH_URI = process.env.COUCH_URI || 'http://admin:admin@0.0.0.0:59840/changes_stream_db'

const TEST_DOC = {
  _id: 'whatever',
  hello: 'there',
  how: 'are',
  you: 'today'
}

// Mocha cannot run tests in a random order.
// Leverage this to run the tests below in sequential order.
describe('integration tests against CouchDB in local docker container', function () {
  it('deletes the database if it exists', (done) => {
    chai.request(COUCH_URI)
      .delete('/')
      .end((err, res) => {
        if (err) {
          console.log('=== DELETE ended with an error')
          console.log(err)
          expect(err).to.equal(null)
        }

        const statusAllowed = res.status === 200 || res.status === 404
        console.log(`Expected status 200 or 404, found status: ${res.status}`)
        expect(statusAllowed).to.equal(true)
        done()
      })
  })

  it('creates the database', (done) => {
    chai.request(COUCH_URI)
      .put('/')
      .end((err, res) => {
        if (err) {
          console.log('=== PUT (create db) ended with an error')
          console.log(err)
          expect(err).to.equal(null)
        }

        const statusAllowed = res.status < 300 && res.status >= 200
        console.log(`Expected 200 <= status < 300, found status: ${res.status}`)
        expect(statusAllowed).to.equal(true)
        done()
      })
  })

  it('inserts a document into the database', function (done) {
    chai.request(COUCH_URI)
      .put('/test-object')
      .send(TEST_DOC)
      .end((err, res) => {
        if (err) {
          console.log('=== PUT (document) ended with an error')
          console.log(err)
          expect(err).to.equal(null)
        }

        console.log(`Expected status === 201, found status: ${res.status}`)
        expect(res.status).to.equal(201)
        done()
      })
  })

  describe('listen for changes on a stream', function () {
    let stream = null

    beforeEach(function () {
      stream = new ChangesStream({
        db: COUCH_URI,
        include_docs: true
      })
    })

    afterEach(function () {
      stream && stream.destroy()
      // null the stream because `let stream = null` is called exactly once
      stream = null
    })

    it("stream can listen to 'data' events", function (done) {
      stream.on('data', function (change) {
        console.log(`change: ${JSON.stringify(change)}`)
        expect(change.id).to.equal('test-object')
        expect(change.seq.charAt(0)).to.equal('1')
        done()
      })
    })

    it("stream will raise an error if 'readable' listener is attached", function (done) {
      try {
        stream.on('readable', function () {
          expect.fail("Attaching a 'readable' listener should throw an error")
          done()
        })
      } catch (err) {
        expect(err.message).to.equal("Handling 'readable' listeners is not implemented")
        done()
      }
    })
  })
})
