var tap = require('tap')
var axios = require('axios')
var durations = require('durations')
var ChangesStream = require('../index')

var chunkSize = 8192
var packages = [
  'durations',
  'npm',
  'bpmn-studio'
]

var pkg = 'bpmn-studio'

fetchPack(pkg, runTests(pkg))

function runTests (pkg) {
  function runner (data) {
    tap.test('Test fast reader', function (t) {
      testReader(t, { pkg, packument: data, slow: false })
    })

    tap.test('Test slow reader', { timeout: 30 * 60 * 1000 }, function (t) {
      testReader(t, { pkg, packument: data, slow: true })
    })
  }

  return runner
}

function fetchPack (pkg, callback) {
  console.info('Fetching', pkg, 'packument for testing ...')
  var watch = durations.stopwatch().start()

  return axios
    .get('https://registry.npmjs.org/' + pkg, {
      onDownloadProgress: function (progress) {
        console.info('progress:', progress)
      },
      verifyStatus: function () {
        return true
      }
    })
    .then(function (result) {
      if (result.status === 200) {
        const raw = Buffer.from(JSON.stringify(result.data) + '\n')
        console.info('Fetched the', pkg, 'packument: ' + raw.length + ' bytes in ' +  watch)
        return callback(raw)
      } else {
        console.error('Failed to fetch', pkg, 'packument: ', result.status, result.data)
      }
    })
    .catch(function (error) {
      console.error('Failed to fetch', pkg, 'packument:', error)
      process.exit(1)
    })
}

function ignore (result) {
  function act () {
    return result
  }

  return act
}

function testReader (t, config) {
  var pkg = config.pkg
  var packument = config.packument
  var watch = durations.stopwatch().start()

  var feed = new ChangesStream({ db: '/', auto_start: false, slow: config.slow })
  
  feed.inactivity_ms = 60 * 1000
  feed.pause = ignore()
  feed.push = ignore(true)
  feed.destroy = ignore()
  feed.attempt = ignore()
  feed.reconnect = ignore()
  feed.request = ignore()
  feed._onResponse = ignore()

  feed._onChange = function () {
    var pack = feed.read()
    console.info(config.slow ? 'Slow' : 'Fast', 'reader parsed the', pkg, 'packument in ' + watch.stop())
    feed.removeAllListeners()
    t.end()
  }

  var total = packument.length
  var written = 0

  function writeMore () {
    var chunkLength = Math.min(total - written, chunkSize)
    var chunk = packument.slice(written, written + chunkLength)
    written += chunkLength

    feed._readData(chunk)

    if (written < total) {
      setImmediate(writeMore)
    } else {
      console.info('All data written.')
    }
  }

  console.info('Writing data ...')

  setImmediate(writeMore)
}

