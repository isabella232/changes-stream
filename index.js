const Readable = require('stream').Readable
const StringDecoder = require('string_decoder').StringDecoder
const { URL } = require('url')
const Util = require('util')
const Debug = require('debug')('changes-stream')
const HTTP = require('http')
const HTTPS = require('https')
const Back = require('back')

var DEFAULT_HEARTBEAT = 30 * 1000

module.exports = ChangesStream

Util.inherits(ChangesStream, Readable)

//
// @ChangeStream
// ## Constructor to initialize the changes stream
//
function ChangesStream (options) {
  if (!(this instanceof ChangesStream)) { return new ChangesStream(options) }
  options = options || {}

  var hwm = options.highWaterMark || 16
  Readable.call(this, { objectMode: true, highWaterMark: hwm })

  this._feedParams = [
    'heartbeat', 'feed', 'filter', 'include_docs', 'view', 'style', 'since',
    'timeout', 'limit'
  ]
  // Bit of a buffer for aggregating data
  this._buffer = ''
  this._decoder = new StringDecoder('utf8')

  this.requestTimeout = options.requestTimeout || 2 * 60 * 1000
  // Time to wait for a new change before we just retry a brand new request
  this.inactivity_ms = options.inactivity_ms || 60 * 60 * 1000
  this.reconnect = options.reconnect || { minDelay: 100, maxDelay: 30 * 1000, retries: 5 }

  // Patch min and max delay using heartbeat
  var minDelay = Math.max(this.reconnect.minDelay, (this.heartbeat || DEFAULT_HEARTBEAT) + 5000)
  var maxDelay = Math.max(minDelay + (this.reconnect.maxDelay - this.reconnect.minDelay), this.reconnect.maxDelay)
  this.reconnect.minDelay = minDelay
  this.reconnect.maxDelay = maxDelay

  this.db = typeof options === 'string'
    ? options
    : options.db

  if (!this.db) {
    throw new Error('database URI is required')
  }

  if (!this.db.endsWith('/')) {
    this.db = `${this.db}/`
  }

  // http option
  this.rejectUnauthorized = options.strictSSL || options.rejectUnauthorized || true
  this.agent = options.agent

  // Setup all query options and defaults
  this.feed = options.feed || 'continuous'
  this.since = options.since || 0
  // Allow couch heartbeat to be used but we can just manage that timeout
  // If passed heartbeat is a number, use the explicitly, if it's a boolean
  // and true, use the default heartbeat, disable it otherwise.
  if (typeof options.heartbeat === 'number') {
    this.heartbeat = options.heartbeat
  } else if (typeof options.heartbeat === 'boolean') {
    this.heartbeat = options.heartbeat ? DEFAULT_HEARTBEAT : false
  } else {
    this.heartbeat = DEFAULT_HEARTBEAT
  }

  this.style = options.style || 'main_only'
  this.query_params = options.query_params || {}
  this.timeout = options.timeout
  this.limit = options.limit

  this.filterIds = Array.isArray(options.filter)
    ? options.filter
    : false

  this.filter = !this.filterIds
    ? (options.filter || false)
    : '_doc_ids'

  this.clientFilter = typeof this.filter === 'function'
  // If we are doing a client side filter we need the actual document
  this.include_docs = !this.clientFilter
    ? (options.include_docs || false)
    : true

  this.use_post = this.filterIds
    ? false
    : (options.use_post || false)

  this.slow = options.slow

  this._destroying = false

  this.request()
}

// Because of the way the _read method is written, 'readable' listeners will
// always end up in paused state.
ChangesStream.prototype.on = function (event, fun) {
  if (event === 'readable') {
    throw new Error("Handling 'readable' listeners is not implemented")
  }

  Object.getPrototypeOf(Readable.prototype).on.call(this, event, fun)
}

//
// Setup all the _changes query options
//
ChangesStream.prototype.preRequest = function () {
  // We want to actually reform this every time in case something has changed
  this.query = this._feedParams.reduce(function (acc, key) {
    if (typeof this[key] !== 'undefined' && this[key] !== false) {
      acc[key] = this[key]
    }
    return acc
  }.bind(this), duplicate(this.query_params))

  // Remove filter from query parameters since we have confirmed it as
  // a function
  if (this.clientFilter) {
    delete this.query.filter
  }
}

//
// Make the changes request and start listening on the feed
//
ChangesStream.prototype.request = function () {
  // Setup possible query string options
  this.preRequest()
  var changesURL = new URL('_changes', this.db)

  if (!this.use_post) {
    changesURL.search = new URLSearchParams(this.query)
  }

  const opts = {
    method: (this.filterIds || this.use_post) ? 'POST' : 'GET',
    timeout: this.requestTimeout,
    rejectUnauthorized: this.rejectUnauthorized,
    headers: {
      accept: 'application/json'
    },
    agent: this.agent
  }

  const hasPayload = this.filterIds || this.use_post

  if (hasPayload) {
    // We will be sending a payload, so set the right type
    opts.headers['content-type'] = 'application/json'
  }

  //
  // Set a timer for the initial request with some extra magic number
  //
  this.timer = setTimeout(this.onTimeout.bind(this), (this.heartbeat || 30 * 1000) + 5000)

  if (changesURL.protocol === 'https:') {
    this.req = HTTPS.request(changesURL, opts)
  } else {
    this.req = HTTP.request(changesURL, opts)
  }

  this.req.setSocketKeepAlive(true)
  this.req.once('error', this._onError.bind(this))
  this.req.once('response', this._onResponse.bind(this))
  if (hasPayload) {
    const payload = Buffer.from(JSON.stringify(this.filterIds || this.query), 'utf8')
    this.req.write(payload)
  }
  this.req.end()
}

//
// Handle the response from a new request
// Remark: Should we use on('data') and just self buffer any events we get
// when a proper pause is called? This may be more intuitive behavior that is
// compatible with how streams3 will work anyway. This just makes the _read
// function essentially useless as it is on most cases
//
// ^ note from the original author.
//
ChangesStream.prototype._onResponse = function (res) {
  clearTimeout(this.timer)
  this.timer = null
  if (res.statusCode !== 200) {
    var err = new Error(`Received '${res.statusCode} ${res.statusMessage}' from couch`)
    err.statusCode = res.statusCode
    return this.emit('error', err)
  }
  this.source = res
  //
  // Set a timer so that we know we are actually getting some changes from the
  // socket
  //
  this.timer = setTimeout(this.onTimeout.bind(this), this.inactivity_ms)
  this.source.on('data', this._readData.bind(this))
  this.source.on('end', this._onEnd.bind(this))
}

//
// Little wrapper around retry for our self set timeouts
//
ChangesStream.prototype.onTimeout = function () {
  clearTimeout(this.timer)
  this.timer = null
  Debug('request timed out or is inactive, lets retry')
  this.retry()
}

// called when data is received: this.source.on('data', this._readData.bind(this))
ChangesStream.prototype._readData = function (data) {
  Debug('data event fired from the underlying _changes response')

  var text = this._decoder.write(data)
  var lines = text.split('\n')

  if (lines.length > 1) {
    this._buffer += lines.shift()
    lines.unshift(this._buffer)
    this._buffer = lines.pop()

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]

      try {
        line = JSON.parse(line)
      } catch (ex) {
        return
      }
      this._onChange(line)
    }
  } else {
    this._buffer += text
  }
}

//
// Process each change request
//
ChangesStream.prototype._onChange = function (change) {
  var query, doc
  if (this.timer) {
    clearTimeout(this.timer)
    this.timer = null
    this.timer = setTimeout(this.onTimeout.bind(this), this.inactivity_ms)
  }

  if (change === '') {
    return this.emit('heartbeat')
  }

  //
  // Update the since value internally as we will need that to
  // be up to date for proper retries
  //
  this.since = change.seq || change.last_seq || this.since

  //
  // This is ugly but replicates the correct behavior
  // for running a client side filter function
  //
  if (this.clientFilter) {
    doc = duplicate(change.doc)
    query = duplicate({ query: this.query })
    if (!this.filter(doc, query)) {
      return
    }
  }

  const pushResult = this.push(change)
  if (!pushResult) {
    console.log(`paused stream push because 'push' returned: ${pushResult}`)
    this.pause()
    this.emit('pause')
    this.source && this.source.pause()
  }

  if (change.last_seq) {
    console.log(`Encountered last sequence in the stream ${change.last_seq}; destroying stream`)
    this.destroy()
  }
}

//
// On error be set for retrying the underlying request
//
ChangesStream.prototype._onError = function (err) {
  this.attempt = this.attempt || Object.assign({}, this.reconnect)
  return Back(function (fail, opts) {
    if (fail) {
      this.attempt = null
      return this.emit('error', err)
    }
    Debug('retry # %d', opts.attempt)

    this.retry()
  }.bind(this), this.attempt)
}

//
// When response ends (for example. CouchDB shuts down gracefully), create an
// artificial error to let the user know what happened.
//
ChangesStream.prototype._onEnd = function () {
  var err = new Error('CouchDB disconnected gracefully')
  err.code = 'ECOUCHDBDISCONNECTEDGRACEFULLY'
  this._onError(err)
}

//
// Cleanup, flush any data, retry the request
//
ChangesStream.prototype.retry = function () {
  Debug('retry request')
  if (this._destroying) return
  this.emit('retry')
  this.cleanup()
  this.request()
}

ChangesStream.prototype.preCleanup = function () {
  let rem = this._buffer.trim()
  if (rem) {
    Debug('attempting to parse remaining data')
    try {
      rem = JSON.parse(rem)
      Debug('parsed the remaining data to JSON; will push')
    } catch (ex) {
      Debug('could not parse the remaining data to JSON; will not push')
      return
    }

    this.push(rem)
  }
}

ChangesStream.prototype.cleanup = function () {
  Debug('cleanup: flushing any possible buffer and killing underlying request')
  if (this.timer) {
    clearTimeout(this.timer)
    this.timer = null
  }
  if (this.req && this.req.socket) {
    this.req.abort()
    this.req = null
  }
  this.preCleanup()
  if (this.source && this.source.socket) {
    this.source.destroy()
    this.source = null
  }
}

// #destroy - from the documentation
// Destroy the stream.
//
// Optionally emit an 'error' event, and emit a 'close' event (unless emitClose
// is set to false). After this call, the readable stream will release any
// internal resources and subsequent calls to push() will be ignored.
// Implementors should not override this method, but instead implement
// readable._destroy().
//
ChangesStream.prototype._destroy = function () {
  Debug('destroy the instance and end the stream')
  this._destroying = true
  // Destroys the source (the  CouchDB connection)
  this.cleanup()
  this._decoder.end()
  this._decoder = null
}

ChangesStream.prototype._read = function (data) {
  this.resume()
  this.emit('resume')
  this.source && this.source.resume()
}

// This is a shallow copy.
// Starting in node 11, we could use to make an efficient deep copy.
// const v8 = require('v8')
// v8.deserialize(v8.serialize(obj))
function duplicate (obj) {
  return JSON.parse(JSON.stringify(obj))
}
