/*  inline demuxer.
 *   probe fragments and instantiate appropriate demuxer depending on content type (TSDemuxer, AACDemuxer, ...)
 */

import Event from '../events';
import {ErrorTypes, ErrorDetails} from '../errors';
import Decrypter from '../crypt/decrypter';
import AACDemuxer from '../demux/aacdemuxer';
import MP4Demuxer from '../demux/mp4demuxer';
import TSDemuxer from '../demux/tsdemuxer';
import MP4Remuxer from '../remux/mp4-remuxer';
import PassThroughRemuxer from '../remux/passthrough-remuxer';

class DemuxerInline {

  constructor(hls,id, typeSupported, config=null) {
    this.hls = hls;
    this.id = id;
    this.config = this.hls.config || config;
    this.typeSupported = typeSupported;
  }

  destroy() {
    var demuxer = this.demuxer;
    if (demuxer) {
      demuxer.destroy();
    }
  }

  push(data, initSegment, audioCodec, videoCodec, timeOffset, cc, level, sn, duration,decryptdata,accurateTimeOffset,defaultInitPTS) {
    if ((data.byteLength > 0) && (decryptdata != null) && (decryptdata.key != null) && (decryptdata.method === 'AES-128')) {
      if (this.decrypter == null) {
        this.decrypter = new Decrypter(this.hls, this.config);
      }
      var localthis = this;
      // performance.now() not available on WebWorker, at least on Safari Desktop
      var startTime;
      try {
        startTime = performance.now();
      } catch(error) {
        startTime = Date.now();
      }
      this.decrypter.decrypt(data, decryptdata.key.buffer, decryptdata.iv.buffer, function (decryptedData) {
        var endTime;
        try {
          endTime = performance.now();
        } catch(error) {
          endTime = Date.now();
        }
        localthis.hls.trigger(Event.FRAG_DECRYPTED, { level : level, sn : sn, stats: { tstart: startTime, tdecrypt: endTime } });
        localthis.pushDecrypted(new Uint8Array(decryptedData), new Uint8Array(initSegment), audioCodec, videoCodec, timeOffset, cc, level, sn, duration, accurateTimeOffset,defaultInitPTS);
      });
    } else {
      this.pushDecrypted(new Uint8Array(data), new Uint8Array(initSegment), audioCodec, videoCodec, timeOffset, cc, level, sn, duration,accurateTimeOffset,defaultInitPTS);
    }
  }

  pushDecrypted(data, initSegment, audioCodec, videoCodec, timeOffset, cc, level, sn, duration,accurateTimeOffset,defaultInitPTS) {
    var demuxer = this.demuxer;
    if (!demuxer || 
       // in case of continuity change, we might switch from content type (AAC container to TS container for example)
       // so let's check that current demuxer is still valid
        (cc !== this.cc && !this.probe(data))) {
      const hls = this.hls;
      const id = this.id;
      const muxConfig = [ {demux : TSDemuxer,  remux : MP4Remuxer},
                          {demux : AACDemuxer, remux : MP4Remuxer},
                          {demux : MP4Demuxer, remux : PassThroughRemuxer}];

      // probe for content type
      for (let i in muxConfig) {
        const mux = muxConfig[i];
        const probe = mux.demux.probe;
        if(probe(data)) {
          demuxer = new mux.demux(hls,id,mux.remux,this.config,this.typeSupported)
          this.probe = probe;
          break;
        }
      }
      if(!demuxer) {
        hls.trigger(Event.ERROR, {type : ErrorTypes.MEDIA_ERROR, id : id, details: ErrorDetails.FRAG_PARSING_ERROR, fatal: true, reason: 'no demux matching with content found'});
        return;
      }
      this.demuxer = demuxer;
    }
    demuxer.push(data,initSegment,audioCodec,videoCodec,timeOffset,cc,level,sn,duration,accurateTimeOffset,defaultInitPTS);
    this.cc = cc;
  }
}

export default DemuxerInline;
