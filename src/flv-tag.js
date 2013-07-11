(function(window) {

var hls = window.videojs.hls;

// (type:uint, extraData:Boolean = false) extends ByteArray
hls.FlvTag = function(type, extraData) {
  var
    // Counter if this is a metadata tag, nal start marker if this is a video
    // tag. unused if this is an audio tag
    adHoc = 0; // :uint

  this.keyFrame = false; // :Boolean

  switch(type) {
  case hls.FlvTag.VIDEO_TAG:
    this.length = 16;
    break;
  case hls.FlvTag.AUDIO_TAG:
    this.length = 13;
    this.keyFrame = true;
    break;
  case hls.FlvTag.METADATA_TAG:
    this.length = 29;
    this.keyFrame = true;
    break;
  default:
    throw("Error Unknown TagType");
  }

  // XXX: I have no idea if 16k is enough to buffer arbitrary FLV tags
  this.bytes = new Uint8Array(16384);
  this.view = new DataView(this.bytes.buffer);
  this.bytes[0] = type;
  this.position = this.length;
  this.keyFrame = extraData; // Defaults to false

  // presentation timestamp
  this.pts = 0;
  // decoder timestamp
  this.dts = 0; 

  // ByteArray#writeBytes(bytes:ByteArray, offset:uint = 0, length:uint = 0)
  this.writeBytes = function(bytes, offset, length) {
    offset = offset || 0;
    length = length || 0;

    try {
      this.bytes.set(bytes.subarray(offset, offset + length), this.position);
    } catch(e) {
      console.log(e);
      throw e;
    }
    this.position += length;
    this.length = Math.max(this.length, this.position);
  };

  // ByteArray#writeByte(value:int):void
  this.writeByte = function(byte) {
    this.bytes[this.position] = byte;
    this.position++;
    this.length = Math.max(this.length, this.position);
  };

  // ByteArray#writeShort(value:int):void
  this.writeShort = function(short) {
    this.view.setUint16(short, this.position);
    this.position += 2;
    this.length = Math.max(this.length, this.position);
  };

  // Negative index into array
  // (pos:uint):int
  this.negIndex = function(pos) {
    return this.bytes[this.length - pos];
  };

  // The functions below ONLY work when this[0] == VIDEO_TAG.
  // We are not going to check for that because we dont want the overhead
  // (nal:ByteArray = null):int
  this.nalUnitSize = function() {
    if (adHoc === 0) {
      return 0;
    }
    
    return this.length - (adHoc + 4);
  };

  this.startNalUnit = function() {
    // remember position and add 4 bytes
    if (adHoc > 0) {
      throw new Error("Attempted to create new NAL wihout closing the old one");
    }

    // reserve 4 bytes for nal unit size
    adHoc = this.length;
    this.length += 4;
    this.position = this.length;
  };

  // (nal:ByteArray = null):void
  this.endNalUnit = function(nalContainer) {
    var
      nalStart, // :uint
      nalLength; // :uint

    // Rewind to the marker and write the size
    if (this.length === adHoc + 4) {
      this.length -= 4; // we started a nal unit, but didnt write one, so roll back the 4 byte size value
    } else if (adHoc > 0) {
      nalStart = adHoc + 4;
      nalLength = this.length - nalStart;

      this.position = adHoc;
      this.view.setUint32(this.position, nalLength);
      this.position = this.length;

      if (nalContainer) {
        // Add the tag to the NAL unit 
        nalContainer.push(this.bytes.subarray(nalStart, nalStart + nalLength));
      }
    }

    adHoc = 0;
  };

  // (key:String, val:Number):void
  this.writeMetaDataDouble = function(key, val) {
    var i;
    this.view.setUint16(this.position, key.length);
    this.position += 2;
    for (i in key) {
      console.assert(key.charCodeAt(i) < 255);
      this.bytes[this.position] = key.charCodeAt(i);
      this.position++; 
    }
    this.view.setUint8(this.position, 0x00);
    this.position++;
    this.view.setFloat64(this.position, val);
    this.position += 2;
    ++adHoc;
  };

  // (key:String, val:Boolean):void
  this.writeMetaDataBoolean = function(key, val) {
    var i;
    this.view.setUint16(this.position, key.length);
    this.position += 2;
    for (i in key) {
      console.assert(key.charCodeAt(i) < 255);
      this.bytes[this.position] = key.charCodeAt(i);
      this.position++;
    }
    this.view.setUint8(this.position, 0x01);
    this.position++;
    this.view.setUint8(this.position, val ? 0x01 : 0x00);
    this.position++;
    ++adHoc;
  };

  // ():ByteArray
  this.finalize = function() {
    var
      dtsDelta, // :int
      len; // :int

    switch(this.bytes[0]) {
      // Video Data
    case hls.FlvTag.VIDEO_TAG:
      this.bytes[11] = ((this.keyFrame || extraData) ? 0x10 : 0x20 ) | 0x07; // We only support AVC, 1 = key frame (for AVC, a seekable frame), 2 = inter frame (for AVC, a non-seekable frame)
      this.bytes[12] = extraData ?  0x00 : 0x01;

      dtsDelta = this.pts - this.dts;
      this.bytes[13] = (dtsDelta & 0x00FF0000) >>> 16;
      this.bytes[14] = (dtsDelta & 0x0000FF00) >>>  8;
      this.bytes[15] = (dtsDelta & 0x000000FF) >>>  0;
      break;

    case hls.FlvTag.AUDIO_TAG:
      this.bytes[11] = 0xAF;
      this.bytes[12] = extraData ? 0x00 : 0x01;
      break;

    case hls.FlvTag.METADATA_TAG:
      this.position = 11;
      this.view.setUint8(this.position, 0x02); // String type
      this.position++;
      this.view.setUint16(this.position, 0x0A); // 10 Bytes
      this.position += 2;
      // set "onMetaData"
      this.bytes.set([0x6f, 0x6e, 0x4d, 0x65,
                      0x74, 0x61, 0x44, 0x61,
                      0x74, 0x61], this.position);
      this.position += 10;
      this.view.setUint8(this.position,
                         this.bytes[this.position] | 0x08); // Array type
      this.position++;
      this.view.setUint32(this.position, adHoc);
      this.position = this.length;
      this.view.setUint32(this.position, 0x09); // End Data Tag
      this.position += 4;
      this.length = this.position;
      break;
    }

    len = this.length - 11;

    this.bytes[ 1] = ( len & 0x00FF0000 ) >>> 16;
    this.bytes[ 2] = ( len & 0x0000FF00 ) >>>  8;
    this.bytes[ 3] = ( len & 0x000000FF ) >>>  0;
    this.bytes[ 4] = ( this.pts & 0x00FF0000 ) >>> 16;
    this.bytes[ 5] = ( this.pts & 0x0000FF00 ) >>>  8;
    this.bytes[ 6] = ( this.pts & 0x000000FF ) >>>  0;
    this.bytes[ 7] = ( this.pts & 0xFF000000 ) >>> 24;
    this.bytes[ 8] = 0;
    this.bytes[ 9] = 0;
    this.bytes[10] = 0;

    this.view.setUint32(this.length, this.length);
    this.length += 4;
    this.position += 4;
    return this;
  };
};

hls.FlvTag.AUDIO_TAG = 0x08; // :uint
hls.FlvTag.VIDEO_TAG = 0x09; // :uint
hls.FlvTag.METADATA_TAG = 0x12; // :uint

// (tag:ByteArray):Boolean {
hls.FlvTag.isAudioFrame = function(tag) {
  return hls.FlvTag.AUDIO_TAG === tag[0];
};

// (tag:ByteArray):Boolean {
hls.FlvTag.isVideoFrame = function(tag) {
  return hls.FlvTag.VIDEO_TAG === tag[0];
};

// (tag:ByteArray):Boolean {
hls.FlvTag.isMetaData = function(tag) {
  return hls.FlvTag.METADATA_TAG === tag[0];
};

// (tag:ByteArray):Boolean {
hls.FlvTag.isKeyFrame = function(tag) {
  if (hls.FlvTag.isVideoFrame(tag)) {
    return tag[11] === 0x17;
  }

  if (hls.FlvTag.isAudioFrame(tag)) {
    return true;
  }
  
  if (hls.FlvTag.isMetaData(tag)) {
    return true;
  }

  return false;
};

// (tag:ByteArray):uint {
hls.FlvTag.frameTime = function(tag) {
  var pts = tag[ 4] << 16; // :uint
  pts |= tag[ 5] <<  8;
  pts |= tag[ 6] <<  0;
  pts |= tag[ 7] << 24;
  return pts;
};

})(this);
