var express = require('express');
var router = express.Router();
var fs = require('fs');
const request = require('request')
const uuid = require('uuid')
const crypto = require('crypto');
const imsize = require('image-size')
const nconf = require('nconf');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

nconf.file('./routes/config.json');

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
        aiinside : {
            endpoint: nconf.get("aiinside:endpoint"),
            apikei: nconf.get("aiinside:apikey" || ''),
            lang: nconf.get('lang') || 'ja'
        }
    }
    res.send( cfg);
});

router.put('/config', function(req,res,next) {
    _changed = 0;
    if (req.body.aiinside && req.body.aiinside.endpoint)
    {
        nconf.set("aiinside:endpoint", req.body.aiinside.endpoint);
        nconf.save()
        _changed = 1;
    }
    if (req.body.aiinside && req.body.aiinside.lang) {
        nconf.set("aiinside:apikey", req.body.aiinside.apikey);
        nconf.save()
        _changed = 1;
    }
    if (req.body.aiinside && req.body.aiinside.lang )
    {
        nconf.set("aiinside:lang", req.body.aiinside.lang);
        nconf.save()
        _changed = 1;
    }
    if( _changed)
    {
        res.sendStatus(200);
    }
    else 
    {
        res.status(404).send("no aiinside.endpoint ");
    }
});

// メイン処理（DU から https://<DU OCR Wrapper hostname>/ として呼び出される想定）
router.post('/', async (req, res) => {
    const apiUrl = nconf.get("aiinside:endpoint");
    const apiKey = nconf.get("aiinside:apikey");
//    console.log(`apiKey: ${apiKey}`);

    try {
        const client = axios.create({
            baseURL: apiUrl,
            headers: {
                'apikey': `${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        // DU から base64 形式で送られてきた帳票イメージをローカルへ保存
        var hash = crypto.createHash('md5').update(req.body.requests[0].image.content).digest('hex');
        let buff = Buffer.from(req.body.requests[0].image.content, "base64");
        var filename = uuid.v4();
        var file_path = __dirname + '/' + filename + '.img';
        fs.writeFileSync(file_path, buff);
//        console.log(`file_path: ${file_path}`);

        const feature = imsize(buff); // __dirname + '/' + filename+'.img');
       
        // ステップ 1: OCR登録
        const uploadResponse = await registerOCR(client, file_path);
        const jobId = uploadResponse.data.id;
//        console.log(`jobId: ${jobId}`);

        // ステップ 2: OCR結果の取得
        const resultResponse = await getRequestResults(client, jobId);
        const ocrResults = resultResponse.data;
//        console.log(`ocrResults: ${JSON.stringify(ocrResults)}`);
        const duResponse = convertToDUFormat(ocrResults, hash, feature);  // OCR 結果を DU が期待する型へ変換
//        console.log(`duResponse: ${JSON.stringify(duResponse)}`);

        // ステップ 3: OCR削除
        const deleteResponse = await deleteOCR(client, jobId);
//        console.log(`deleteResponse: ${JSON.stringify(deleteResponse.data)}`);

        // ステップ 4: ファイル削除
        await deleteFile(file_path);

        res.status(200).json(duResponse);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// OCR登録
const registerOCR = async (client, file_path) => {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(file_path), {
        filename: path.basename(file_path),
        contentType: 'application/pdf'
    });
    formData.append('concatenate', '0');
    formData.append('characterExtraction', '1');
    formData.append('tableExtraction', '1');

    const formHeaders = formData.getHeaders();

    return client.post(`/register`, formData, { headers: formHeaders });
};

// OCR結果の取得
const getRequestResults = async (client, jobId) => {
    let status = 'inprogress';
    let retries = 0;
    const maxRetries = 120;
    let resultResponse;

    while (status !== 'done' && retries < maxRetries) {
        resultResponse = await client.get(`/getOcrResult?id=${jobId}`);
        status = resultResponse.data.status;
//        console.log(`Current status: ${status}`);

        if (status === "done") {
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 5000)); // 5秒待機
        retries++;
    }

    if (retries >= maxRetries) {
        throw new Error('OCR読取りに時間が掛かったため、タイムアウトが発生しました。');
    }

    return resultResponse;
};

// OCR削除
const deleteOCR = async (client, jobId) => {
    return response = await client.post(`/delete`, {
        fullOcrJobId: jobId
    });
};

// ファイル削除
const deleteFile = async (file_path) => {
    return new Promise((resolve, reject) => {
        fs.unlink(file_path, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// OCR結果をDU形式に変換する関数
const convertToDUFormat = (ocrResults, hash, feature) => {
    if (!ocrResults || !ocrResults.results) {
        throw new Error('Invalid OCR results format');
    }

    const du_resp = {
        responses: [
            {
                angle: 0,
                textAnnotations: [
                    {
                        description: '',
                        score: 0,
                        type: 'text',
                        image_hash: hash,
                        boundingPoly: {
                            vertices: [
                                { x: 0, y: 0 },
                                { x: feature.width, y: 0 },
                                { x: feature.width, y: feature.height },
                                { x: 0, y: feature.height }
                            ]
                        }
                    }
                ]
            }
        ]
    };

    let desc = '';
    let min_score = 1.0;

    ocrResults.results.forEach(result => {
        result.pages.forEach(page => {
            page.ocrResults.forEach(field => {
                const singleLine = field.text;
                const boundingBox = field.bbox;

                if (singleLine && boundingBox) {
                    du_resp.responses[0].textAnnotations.push({
                        description: singleLine,
                        score: field.confidence || 1.0,
                        type: 'text',
                        boundingPoly: {
                            vertices: [
                                { x: boundingBox.left * feature.width, y: boundingBox.top * feature.height },
                                { x: boundingBox.right * feature.width, y: boundingBox.top * feature.height },
                                { x: boundingBox.right * feature.width, y: boundingBox.bottom * feature.height },
                                { x: boundingBox.left * feature.width, y: boundingBox.bottom * feature.height }
                            ]
                        }
                    });
                    desc += singleLine + ' ';
                    min_score = Math.min(min_score, field.confidence || 1.0);
                }
            });
        });
    });

    du_resp.responses[0].textAnnotations[0].description = desc.trim();
    du_resp.responses[0].score = min_score;

    return du_resp;
};

module.exports = router;
