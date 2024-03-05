var express = require('express');
var router = express.Router();
var fs = require('fs');
const request = require('request')
const uuid = require('uuid')
const crypto = require('crypto');
const imsize = require('image-size')
const nconf = require('nconf');

nconf.file( './routes/config.json');

const rot_val = [0, 270, 180, 90];
/* OCR Endpoint 基本情報 */
router.get('/info/model', function(req,res,next) {
    const info = {
            accents:false,
            commit:"309c4703a92d41ca08d470955f0e253b416b151b",
            gpu:true,
            model:"du-ocr",
            rotation_detection:true,
            version:"1.0.0"
        }
    res.send( info);
});

router.get('/config', function(req,res,next) {
    const cfg = {
        clova : {
            endpoint: nconf.get("clova:endpoint"),
            lang: nconf.get('lang') || 'ko,ja'
        }
    }
    res.send( cfg);
});

router.put('/config', function(req,res,next) {
    _changed = 0;
    if( req.body.clova && req.body.clova.endpoint )
    {
        nconf.set("clova:endpoint", req.body.clova.endpoint);
        nconf.save()
        _changed = 1;
        
    }
    if( req.body.clova && req.body.clova.lang )
    {
        nconf.set("clova:lang", req.body.clova.lang);
        nconf.save()
        _changed = 1;
    }
    if( _changed)
    {
        res.sendStatus(200);
    }
    else 
    {
        res.status(404).send("no clova.endpoint ");
    }
});

/* POST body listing. */
router.post('/', function(req, res, next) {
    //const clova_endpoint = process.env.CLOVA_ENDPOINT || "https://412baztid8.apigw.ntruss.com/custom/v1/83/962db625f801e2f12fd4eb7ce08994255f56d8a27639ea5c30e23cac89b10a86/general";
    const clova_endpoint = process.env.CLOVA_ENDPOINT || nconf.get("clova:endpoint");
    res.writeContinue();
    var hash = crypto.createHash('md5').update( req.body.requests[0].image.content).digest('hex');  
    let buff = Buffer.from( req.body.requests[0].image.content, "base64");
    var filename = uuid.v4();
    fs.writeFileSync( __dirname + '/' + filename+'.img', buff);

    const feature = imsize( buff); // __dirname + '/' + filename+'.img');

    const req_msg = {
        version: 'V2',
        requestId : filename,
        timestamp : Date.now(),
        lang:  nconf.get("lang") || 'ko,ja',
        images : [{
            name: filename,
            format: 'jpeg'
  //          ,data: req.body.requests[0].image.content // for application/json
        }]
    }
    //multipart/form-data
    const formdata = {
        message : JSON.stringify(req_msg),
        file : fs.createReadStream( __dirname + '/'+ filename+'.img')
    }

    const options = {
        url: clova_endpoint,
        method: 'POST',
        formData: formdata,
//        json: req_msg,
        headers: {
            'X-OCR-SECRET': req.headers['x-uipath-license'],
//            'Content-Type': 'application/json'
            'Content-Type': 'multipart/form-data'
            }
    }

    request.post( options, function(err, resp) {
        fs.unlink( __dirname + '/' + filename + '.img', (err2) => {
            if( err2)
                console.error('error on file deletion ');
        });
        if( err) {
            console.log(err);
            return res.status(500).send("Unknown error");
        } 
        
        clova = JSON.parse(resp.body);
        if( resp.statusCode == 401 || resp.statusCode == 402) 
        {
            return res.status(401).send("Unauthorized");
        }
        if( resp.statusCode != 200) {
            console.log( clova);
            return res.status(415).send("Unsupported Media Type or Not Acceptable ");
        }
        var min_score = 1.0;
        var full_text = ''
        var du_resp = {
            responses: [
                {
                    angle: 0, // 後でskew値を計算して更新する 
                    textAnnotations: [
                        {
                            description : '',
                            score: 0,
                            type: 'text',
                            image_hash: hash,
                            boundingPoly : { // 応答値が該当する内容がないため、画像のサイズ情報を利用して構成する 
                                vertices: [
                                    {x: 0, y: 0},
                                    {x: feature.width, y: 0},
                                    {x: feature.width, y: feature.height},
                                    {x: 0, y: feature.height}
                                ]
                            }
                        }
                    ]
                }
            ]
        }
        var desc;
        var skew = [0,0,0,0];// { 0, 90, 180, 270 } 回転した文書
        var rotation_check_count = 20;
        clova.images[0].fields.forEach( p => {
            du_resp.responses[0].textAnnotations.push ({
                description: p.inferText,
                score: p.inferConfidence,
                type: 'text',
                boundingPoly: p.boundingPoly // 構成が同じなのでそのまま使用 
            });
            desc += p.inferText;
            if( p.lineBreak)
                desc += "\n";
            min_score =  Math.min( min_score, p.inferConfidence);
            if( rotation_check_count >= 0) {
                if( p.boundingPoly.vertices[0].x == p.boundingPoly.vertices[1].x &&
                    p.boundingPoly.vertices[1].y == p.boundingPoly.vertices[2].y && 
                    p.boundingPoly.vertices[2].x > p.boundingPoly.vertices[3].x )
                    skew[1]++;
                else if ( p.boundingPoly.vertices[0].y == p.boundingPoly.vertices[1].y && 
                    p.boundingPoly.vertices[1].x == p.boundingPoly.vertices[2].x &&
                    p.boundingPoly.vertices[1].x < p.boundingPoly.vertices[0].x )
                    skew[2]++;
                else if ( p.boundingPoly.vertices[0].x == p.boundingPoly.vertices[1].x && 
                    p.boundingPoly.vertices[1].y == p.boundingPoly.vertices[2].y && 
                    p.boundingPoly.vertices[2].x > p.boundingPoly.vertices[1].x )
                    skew[3]++;
                else
                    skew[0]++;
                rotation_check_count--;
            }
        })
        var max_idx = 0, max=0, idx=0;
        for( idx =0; idx < skew.length; idx++)
        {
            if( skew[idx] > max) {
                max = skew[idx];
                max_idx = idx;
            }
        }
        du_resp.responses[0].description = desc;
        du_resp.responses[0].angle =  rot_val[max_idx];
        // 最も低いscore値を使用
        du_resp.responses[0].score = min_score;
        //console.log( JSON.stringify(du_resp));
        res.send( du_resp);
    });
});



module.exports = router;
