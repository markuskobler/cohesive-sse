'use strict';

var exports = module.exports = function(heatbeat, retry) {
  return new Server(heatbeat, retry)
}

var _uniqueID = 0, _iePadding = new Array(2049).join(' ')

function Server(heartbeat, retry) {
  if (heartbeat !== void 0 && heartbeat !== null) {
    heartbeat = 20 * 1000
  }
  this._retry = (retry !== void 0 && retry !== null) ? retry : (5 * 1000)
  this._intervalId = heartbeat > 0 ? setInterval(this._onHeartbeat, heartbeat) : -1
  this._written = this._first = this._stale = void 0
}
exports.Server = Server

Server.prototype.connect = function(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'private, no-cache, proxy-revalidate, post-check=0, pre-check=0',
    'Pragma': 'no-cache',
    'Expires':'Tue, 01 Jan 2013 00:00:01 GMT',
    'Last-Modified': 'Tue, 01 Jan 2013 00:00:01 GMT'
  })
  if (this._retry > -1) {
    res.write('retry: '+this._retry+"\n")
  }
  res.write(':' + _iePadding + "\n") // 2kB padding for IE<10
  res.flush()

  var conn = this.register(res)
  req.on("close", function(){
    conn.dispose()
  })
  return conn
}

Server.prototype.register = function(res) {
  var conn = new Connection(++_uniqueID, res, this._written, this)
  if (this._written) {
    this._written._next = conn
    conn._prev = this._written
  } else {
    this._first = conn
  }
  return (this._written = conn)
}

Server.prototype.broadcast = function(message, opt_eventId, opt_type) {
  var conn = this._stale
  while (conn) {
    write(conn._res, message, opt_eventId, opt_type)
    if (conn._next) {
      conn = conn._next
    } else {
      break
    }
  }
  if (this._first) {
    this._first._prev = conn
    conn._next = this._first
    conn = this._first
    while(conn) {
      write(conn._res, message, opt_eventId, opt_type)
      if (conn._next) {
        conn = conn._next
      } else {
        break
      }
    }
  } else {
    this._written = conn
  }
  if( this._state ) {
    this._first = this._stale
    this.stale = void 0
  }
}

Server.prototype._onHeartbeat = function() {
  var conn = this._stale
  while (conn) {
    conn._res.write(': heartbeat\n')
    conn._res.flush()

    if (conn._next) {
      conn = conn._next
    } else {
      if (this._first) {
        this._written._next = this._stale
        this._stale._prev = this._written
        this._stale = this._first
      }
      this._written = this._first = void 0
      return
    }
  }
}

Server.prototype.dispose = function() {
  if (this._intervalId > -1) {
    clearInterval(this._intervalId)
    delete this._intervalId
  }
}

function Connection(id, res, prev, owner) {
  this._id = id
  this._res = res
  this._prev = prev
  this._owner = owner
  this._next = void 0
}

Connection.prototype.write = function(message, opt_eventId, opt_type) {
  write(this._res, message, opt_eventId, opt_type)

  var w = this._owner._written
  if (w === this) return
  this._owner._written = this
  if( !this._owner._first ) {
    this._owner._first = this
  }

  if (this._next) {
    this._next._prev = this._prev
  }

  if (this._prev) {
    this._prev._next = this._next
  } else if (this === this._owner._stale) {
    this._owner._stale = this._next
  }

  this._next = void 0
  if (w) {
    this._prev = w
    w._next = this
  }
}

Connection.prototype.dispose = function() {
  if (this._next) {
    this._next._prev = this._prev
  } else if (this === this._owner._written) {
    this._owner._written = this._prev
    return
  }

  if (this._prev) {
    this._prev._next = this._next
  } else if (this === this._owner._stale) {
    this._stale = this._next
  }
}


function write(res, message, opt_eventId, opt_type) {
  if (opt_eventId !== void 0 && opt_eventId !== null) {
    res.write('id: '+opt_eventId+'\n')
  }
  if (opt_type) {
    res.write('event: '+opt_type+'\n')
  }
  res.write(message.split('\n').join('\ndata: ')+'\n\n')
  res.flush()
}
