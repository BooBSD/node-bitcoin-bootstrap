var crypto = require('crypto'),
	base58 = require('./base58'),
	Opcode = require('./opcode');


var getAddressFromPubKeyHash = function(hash) {
	var hash = new Buffer('00' + hash.toString('hex'), 'hex');
	var checksum = crypto.createHash('sha256').update(crypto.createHash('sha256').update(hash).digest()).digest().slice(0, 4);
	var address = base58.encode(new Buffer(hash.toString('hex') + checksum.toString('hex'), 'hex'));
	return address;
}

var getAddressFromPubKey = function(pubkey) {
	var b = new Buffer(pubkey, 'hex');
	var hash = crypto.createHash('ripemd160').update(crypto.createHash('sha256').update(b).digest()).digest();
	return getAddressFromPubKeyHash(hash);
}

var parse = function(buffer) {
	var chunks = [];
	var i = 0;

	function readChunk(n) {
		chunks.push(buffer.slice(i, i + n));
		i += n;
	};

	while(i < buffer.length) {
		var opcode = buffer[i++];
		if (opcode >= 0xF0) {
			// Two byte opcode
			opcode = (opcode << 8) | buffer[i++];
		}

		var len;
		if (opcode > 0 && opcode < Opcode.map.OP_PUSHDATA1) {
			// Read some bytes of data, opcode value is the length of data
			readChunk(opcode);
		} else if (opcode == Opcode.map.OP_PUSHDATA1) {
			len = buffer[i++];
			readChunk(len);
		} else if (opcode == Opcode.map.OP_PUSHDATA2) {
			len = (buffer[i++] << 8) | buffer[i++];
			readChunk(len);
		} else if (opcode == Opcode.map.OP_PUSHDATA4) {
			len = (buffer[i++] << 24) |
				(buffer[i++] << 16) |
				(buffer[i++] << 8) |
				buffer[i++];
			readChunk(len);
		} else {
			chunks.push(opcode);
		}
	}
	return chunks;
};

exports.getAddresses = function(buffer) {
	var chunks = parse(buffer);
	var addresses = [];
	if(chunks[chunks.length-1] == Opcode.map.OP_CHECKMULTISIG && chunks[chunks.length-2] <= 3) {
		for (var i = 1; i < chunks.length-2; ++i) {
			addresses.push(getAddressFromPubKey(chunks[i]));
		}
	} else if(chunks.length == 5 && chunks[0] == Opcode.map.OP_DUP && chunks[1] == Opcode.map.OP_HASH160 && chunks[3] == Opcode.map.OP_EQUALVERIFY && chunks[4] == Opcode.map.OP_CHECKSIG) {
		addresses.push(getAddressFromPubKeyHash(chunks[2]));
	} else if(chunks.length == 2 && chunks[1] == Opcode.map.OP_CHECKSIG) {
		addresses.push(getAddressFromPubKey(chunks[0]));
	}
	return addresses;
};
