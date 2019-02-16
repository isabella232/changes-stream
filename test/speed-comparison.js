const c = require('@buzuli/color')
const tap = require('tap')
const axios = require('axios')
const durations = require('durations')
const ChangesStream = require('../index')

const seq = require('@buzuli/seq')()

const chunkSize = 8192
const packages = [
  'durations',
  'npm',
  'bpmn-studio'
]

run()

async function run () {
  try {
    for (const pkg of packages) {
      await compareModes(pkg)
    }
  } catch (error) {
    console.error('\nFatal:', error)
  }
}

async function compareModes (pkg) {
  const packument = await fetchPack(pkg)
  await testReader({ pkg, packument, slow: false })
  await testReader({ pkg, packument, slow: true })
}

async function fetchPack (pkg) {
  async function request () {
    const { data } = await axios.get(`https://registry.npmjs.org/${pkg}`)

    return Buffer.from(JSON.stringify(data) + '\n')
  }

  function resultHandler ({ failure, duration, result: data }) {
    if (failure) {
      return `${failure}`
    } else {
      return `${data.length} bytes`
    }
  }

  const result = await seq(
    `Fetching ${c.blue(pkg)} packument for testing`,
    request,
    resultHandler
  )

  return result
}

async function testReader ({ pkg, packument, slow }) {
  async function parse () {
    return new Promise((resolve, reject) => {
      try {
        var watch = durations.stopwatch().start()

        var feed = new ChangesStream({
          db: '/',
          auto_start: false,
          slow
        })
        
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
          feed.removeAllListeners()
          resolve({ bytes: packument.length })
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
          }
        }

        setImmediate(writeMore)
      } catch (error) {
        reject(error)
      }
    })
  }

  await seq(
    `${slow ? 'Slow' : 'Fast'} parsing ${c.blue(pkg)}`,
    parse
  )
}

function ignore (result) {
  function act () {
    return result
  }

  return act
}
