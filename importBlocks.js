var fs = require('fs'),
	crypto = require('crypto'),
	util = require('util'),
	events = require('events'),
	ref = require('ref'),
	script = require('./script');

var redis = require('redis').createClient();
redis.on('error', function(error) {
	util.log(error);
});


Buffer.prototype.reverse = function() {
	var a = [];
	for(var i = this.length - 1; i >= 0; i--) {
		a.push(this[i]);
	}
	return new Buffer(a);
}

var getVarInt = function(buffer, offset) {
	var firstByte = buffer.readUInt8(offset);
	if(firstByte < 253) return [firstByte, 1];
	else if(firstByte == 253) return [buffer.readUInt16LE(offset + 1), 3];
	else if(firstByte == 254) return [buffer.readUInt32LE(offset + 1), 5];
	else return [parseInt(buffer.readUInt64LE(offset + 1)), 9];
}

var redisTxIn = function(txid, n, callback) {
	var txn = txid + ':' + n;
	redis.smembers(txn, function(error, addresses) {
		if(error) util.log(error)
		else {
			var commands = addresses.map(function(address) { return ['zrem', address, txn] });
			commands.push(['del', txn]);
			redis.multi(commands).exec(function(error) {
				if(error) util.log(error);
				else callback();
			});
		}
	});
}

var redisTxOut = function(txid, n, value, addresses, callback) {
	if(addresses.length > 0) {
		var txn = txid + ':' + n;
		redis.sadd(txn, addresses, function(error) {
			if(error) util.log(error)
			else {
				var commands = addresses.map(function(address) { return ['zadd', address, value, txn] });
				redis.multi(commands).exec(function(error) {
					if(error) util.log(error);
					else callback();
				});
			}
		});
	} else callback();
}

var parseTxIn = function(buffer, offset, ins) {
	var txid = buffer.slice(offset, offset + 32);
	var n = buffer.readUInt32LE(offset + 32);
	if(n != 4294967295) {
		ins.push({txid: txid.reverse().toString('hex'), n: n});
	}
	var scriptLength = getVarInt(buffer, offset + 36);
	return offset + 36 + scriptLength[0] + scriptLength[1] + 4;
}

var parseTxIns = function(buffer, count, offset, ins) {
	for(var i = 0; i < count; i++) {
		offset = parseTxIn(buffer, offset, ins);
	}
	return offset;
}

var parseTxOut = function(buffer, offset, outs, n) {
	var value = buffer.readInt64LE(offset) / 100000000;
	var scriptLength = getVarInt(buffer, offset + 8);
	var scriptBuffer = buffer.slice(offset + 8 + scriptLength[1], offset + 8 + scriptLength[1] + scriptLength[0]);
	var addresses = script.getAddresses(scriptBuffer);
	outs.push({n: n, value: value, addresses: addresses});
	return offset + 8 + scriptLength[0] + scriptLength[1];
}

var parseTxOuts = function(buffer, count, offset, outs) {
	for(var n = 0; n < count; n++) {
		offset = parseTxOut(buffer, offset, outs, n);
	}
	return offset;
}

var getTxId = function(buffer, start, end) {
	var b = buffer.slice(start, end);
	return crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest().reverse().toString('hex');
}

var parseTransaction = function(buffer, offset, callback) {
	var ins = [];
	var outs = [];
	var txInsCount = getVarInt(buffer, offset + 4);
	var txInsOffset = parseTxIns(buffer, txInsCount[0], offset + 4 + txInsCount[1], ins);
	var txOutsCount = getVarInt(buffer, txInsOffset);
	var txOutsOffset  = parseTxOuts(buffer, txOutsCount[0], txInsOffset + txOutsCount[1], outs);
	var newOffset = txOutsOffset + 4;
	var txid = getTxId(buffer, offset, newOffset);
	var shiftIns = function() {
		if(ins.length) {
			var vin = ins.shift();
			redisTxIn(vin.txid, vin.n, function() {
				shiftIns();
			});
		} else {
			var shiftOuts = function() {
				if(outs.length) {
					var out = outs.shift();
					redisTxOut(txid, out.n, out.value, out.addresses, function() {
						shiftOuts();
					});
				} else callback(newOffset);
			}
			shiftOuts();
		}
	}
	shiftIns();
}

var parseTransactions = function(buffer, count, offset) {
	var parseTx = function(offset, i) {
		parseTransaction(buffer, offset, function(offset) {
			if(i < count) parseTx(offset, ++i);
			else if(i == count) emitter.emit('message');
		});
	}
	parseTx(offset, 1);
}

var parseBlock = function(buffer) {
	var txCount = getVarInt(buffer, 80);
	parseTransactions(buffer, txCount[0], txCount[1] + 80);
	console.log(util.format('Loading block: %s, transactions: %s', blockCount, txCount[0]));
	blockCount += 1;
}

var readMessage = function() {
	var messageBuffer = new Buffer(8);
	var l = fs.readSync(fd, messageBuffer, 0, 8, null);
	if(l !== 0) {
		var blockLength = messageBuffer.readUInt32LE(4);
		var blockBuffer = new Buffer(blockLength);
		fs.readSync(fd, blockBuffer, 0, blockLength, null);
		parseBlock(blockBuffer);
	} else {
		redis.set('block', blockCount - 1, function(error) {
			if(error) util.log(error);
			else {
				redis.quit();
				console.log('Done.');
			}
		});
	}
}

var emitter = new events.EventEmitter();

emitter.on('message', function() {
	setImmediate(readMessage);
});

var blockCount = 0;

var filename = process.argv[2];
fd = fs.openSync(filename, 'r');

redis.on('ready', function() {
	emitter.emit('message');
});
