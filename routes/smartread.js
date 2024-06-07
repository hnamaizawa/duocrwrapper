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
        smartread : {
            endpoint: nconf.get("smartread:endpoint"),
            lang: nconf.get('lang') || 'ja'
        }
    }
    res.send( cfg);
});

router.put('/config', function(req,res,next) {
    _changed = 0;
    if (req.body.smartread && req.body.smartread.endpoint)
    {
        nconf.set("smartread:endpoint", req.body.smartread.endpoint);
        nconf.save()
        _changed = 1;
    }
    if (req.body.smartread && req.body.smartread.lang )
    {
        nconf.set("smartread:lang", req.body.smartread.lang);
        nconf.save()
        _changed = 1;
    }
    if( _changed)
    {
        res.sendStatus(200);
    }
    else 
    {
        res.status(404).send("no smartread.endpoint ");
    }
});

// メイン処理（DU から https://<DU OCR Wrapper hostname>/ として呼び出される想定）
router.post('/', async (req, res) => {
    const apiUrl = nconf.get("smartread:endpoint");
    const apiKey = req.headers['x-uipath-license'];

    try {
        const client = axios.create({
            baseURL: apiUrl,
            headers: {
                'Authorization': `apikey ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        // DU から base64 形式で送られてきた帳票イメージをローカルへ保存
        var hash = crypto.createHash('md5').update(req.body.requests[0].image.content).digest('hex');
        let buff = Buffer.from(req.body.requests[0].image.content, "base64");
        var filename = uuid.v4();
        var file_path = __dirname + '/' + filename + '.img';
        fs.writeFileSync(file_path, buff);

        const feature = imsize(buff); // __dirname + '/' + filename+'.img');

        // ステップ 1: タスクの作成
        const taskResponse = await createTask(client);
        const taskId = taskResponse.data.taskId;
//        console.log(`Task ID: ${taskId}`);
        
        // ステップ 2: ファイルのアップロード
//        console.log(`file_path: ${file_path}`);
        const uploadResponse = await uploadFile(client, taskId, file_path);
        const requestId = uploadResponse.data.requestId;
//        console.log(`Request ID: ${requestId}`);

        // ステップ 3: リクエストの状態チェック
        const status = await checkRequestStatus(client, taskId);
//        console.log(`Request status: ${status}`);

        // ステップ 4: 結果の取得
        const resultResponse = await getRequestResults(client, requestId);
        const ocrResults = resultResponse.data;
//        console.log(`ocrResults: ${JSON.stringify(ocrResults)}`);
        const duResponse = convertToDUFormat(ocrResults, hash, feature);  // OCR 結果を DU が期待する型へ変換

        // ステップ 5: タスクの削除
        await deleteTask(client, taskId);

        // ファイルの削除
        await deleteFile(file_path);

//        console.log(`duResponse: ${JSON.stringify(duResponse)}`);
        res.status(200).json(duResponse);
    } catch (error) {
        console.error('Error:', error);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
            res.status(error.response.status).send(error.response.data);
        } else if (error.request) {
            console.error('Request data:', error.request);
            res.status(500).send('No response received from the server');
        } else {
            console.error('Error message:', error.message);
            res.status(500).send(error.message);
        }
    }
});

// サブ処理
const createTask = async (client) => {
    const requestBody = {
        exportSettings: {
            type: "json",
            aggregation: "oneFile"
        },
        name: "UiPath DU OCR Wrapperリクエスト",
        allowUseOfData: false,
        description: "UiPath DU OCR Wrapperからのリクエストです",
        labels: {
//            property1: "string",
//            property2: "string"
        },
        languages: ["ja"],
        requestType: "freeform"
    };
    return client.post('/task', requestBody);
};

const uploadFile = async (client, taskId, file_path) => {
    const formData = new FormData();
    formData.append('image', fs.createReadStream(file_path), {
        filename: path.basename(file_path),
        contentType: 'application/pdf'
    });
    const formHeaders = formData.getHeaders();

    return client.post(`/task/${taskId}/request`, formData, { headers: formHeaders });
};

const checkRequestStatus = async (client, taskId) => {
    let status = 'PENDING';
    let retries = 0;
    const maxRetries = 120;

    while (status !== 'COMPLETED' && retries < maxRetries) {
        const statusResponse = await client.get(`/task/${taskId}`);
        status = statusResponse.data.state;
//        console.log(`Current status: ${status}`);

        if (statusResponse.data.requestStateSummary.OCR_COMPLETED > 0) {
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 5000)); // 5秒待機
        retries++;
    }

    if (retries >= maxRetries) {
        throw new Error('OCR読取りに時間が掛かったため、タイムアウトが発生しました。');
    }

    return status;
};

const getRequestResults = async (client, requestId) => {
    return client.get(`/request/${requestId}/results?offset=0&limit=100`);  // 最大100ページの制限を実施
};

const deleteTask = async (client, taskId) => {
    return client.delete(`/task/${taskId}`);
};

const deleteFile = async (file_path) => {
    return new Promise((resolve, reject) => {
        fs.unlink(file_path, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

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
            page.fields.forEach(field => {
                const singleLine = field.singleLine;
                const boundingBox = field.boundingBox;

                if (singleLine && boundingBox) {
                    du_resp.responses[0].textAnnotations.push({
                        description: singleLine.text,
                        score: singleLine.confidence,
                        type: 'text',
                        boundingPoly: {
                            vertices: [
                                { x: boundingBox.x, y: boundingBox.y },
                                { x: boundingBox.x + boundingBox.width, y: boundingBox.y },
                                { x: boundingBox.x + boundingBox.width, y: boundingBox.y + boundingBox.height },
                                { x: boundingBox.x, y: boundingBox.y + boundingBox.height }
                            ]
                        }
                    });
                    desc += singleLine.text + ' ';
                    min_score = Math.min(min_score, singleLine.confidence);
                }
            });
        });
    });

    du_resp.responses[0].textAnnotations[0].description = desc.trim();
    du_resp.responses[0].score = min_score;

    return du_resp;
};



module.exports = router;
