## changes-stream

Forked from https://github.com/jcrugzz/changes-stream

A fault tolerant changes stream with builtin retry.

Inspired by [`follow`][https://github.com/iriscouch/follow].

### Notes

Attaching a 'readable' listener is not supported (yet).

### Install

```sh
$ npm install @npmcorp/changes-stream --save
```

### Test

```sh
# Standup a container with a CouchDB instance
$ npm run docker:fresh
$ npm test

# To enable debug logging from ./index.js:
$ DEBUG=changes-stream npm test
```

Alternatively, use `COUCH_URI` to point to an existing CouchDB.

```sh
$ COUCH_URI=http://user:pass@example-couch.com:5984/changes_stream_db \
   npm test
```

### Options

Options to customize `_changes` request.

```js
{
  // full database URL
  db: 'http://localhost:5984/my_db',

  // Can also be longpoll technically but not currently implemented
  feed: 'continuous',

  // Can be a defined couchdb view, a local filter function or an array of IDs
  filter: 'docs/whatever',

  // How long to wait before retrying the request
  inactivity_ms: 60 * 60 * 1000,

  // How long (in milliseconds) CouchDB should wait for a change before closing
  // the feed
  timeout: undefined,

  // http timeout
  requestTimeout: 2 * 60 * 1000,

  // http agent
  agent: undefined,

  // update sequence to start from, 'now' will start it from latest
  since: 0,

  // how often (in milliseconds) we want couchdb to send us a heartbeat message
  heartbeat: 30 * 1000,

  // { main_only | all_docs }
  // Specifies how many revisions are returned in the changes array. The default,
  // main_only, will only return the current “winning” revision; all_docs will
  // return all leaf revisions (including conflicts and deleted former conflicts.)
  style: 'main_only',

  // whether or not we want to return the full document as a property
  include_docs: false,

  // custom arbitrary params to send in request e.g. { hello: 'world' }
  query_params: {},

  // switch the default HTTP method to POST (cannot be used with a filter array)
  use_post: false
}
```
