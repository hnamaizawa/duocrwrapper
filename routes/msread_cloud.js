var express = require('express');
var router = express.Router();
var fs = require('fs');
const uuid = require('uuid');
const crypto = require('crypto');
const imsize = require('image-size');
const nconf = require('nconf');
const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const FormData = require('form-data');
const path = require('path');
const kuromoji = require('kuromoji');

nconf.file('./routes/config.json');

router.get('/info/model', function (req, res, next) {
    const info = {
        accents: false,
        commit: "309c4703a92d41ca08d470955f0e253b416b151b",
        gpu: true,
        model: "du-ocr",
        rotation_detection: true,
        version: "1.0.0"
    };
    res.send(info);
});

router.get('/config', function (req, res, next) {
    const cfg = {
        msread_cloud: {
            endpoint: nconf.get("msread_cloud:endpoint"),
            apikei: nconf.get("msread_cloud:apikey" || ''),
            lang: nconf.get('lang') || 'ja'
        }
    };
    res.send(cfg);
});

router.put('/config', function (req, res, next) {
    let _changed = 0;
    if (req.body.msread_cloud && req.body.msread_cloud.endpoint) {
        nconf.set("msread_cloud:endpoint", req.body.msread_cloud.endpoint);
        nconf.save();
        _changed = 1;
    }   
    if (req.body.msread_cloud && req.body.msread_cloud.apikey) {
        nconf.set("msread_cloud:apikey", req.body.msread_cloud.apikey);
        nconf.save()
        _changed = 1;
    }
    if (req.body.msread_cloud && req.body.msread_cloud.lang) {
        nconf.set("msread_cloud:lang", req.body.msread_cloud.lang);
        nconf.save();
        _changed = 1;
    }
    if (_changed) {
        res.sendStatus(200);
    } else {
        res.status(404).send("no msread_cloud.endpoint ");
    }
});

// メイン処理（DU から https://<DU OCR Wrapper hostname>/ として呼び出される想定）
router.post('/', async (req, res) => {
    const apiUrl = nconf.get("msread_cloud:endpoint");
    const apiKey = nconf.get("msread_cloud:apikey");
    
    try {
//        console.log(`apiURL # ${apiUrl} : apiKey # ${apiKey}`);
        const client = new DocumentAnalysisClient(apiUrl, new AzureKeyCredential(apiKey));

        // DU から base64 形式で送られてきた帳票イメージをローカルへ保存
        var hash = crypto.createHash('md5').update(req.body.requests[0].image.content).digest('hex');
        let buff = Buffer.from(req.body.requests[0].image.content, "base64");
        var filename = uuid.v4();
        var file_path = __dirname + '/' + filename + '.img';
        fs.writeFileSync(file_path, buff);

        const feature = imsize(buff);

        // ドキュメントの解析
        const poller = await client.beginAnalyzeDocument("prebuilt-read", fs.createReadStream(file_path));
        const result = await poller.pollUntilDone();

        if (!result) {
            console.error("No result.");
            return;
        }

        // Azure OCR API の結果をログに出力
        //        logAzureOcrResult(result);

        // 結果を DU のフォーマットに変換してレスポンスとして返す
        const duResponse = await convertToDUFormat(result, hash, feature);

        // ファイルの削除
        await deleteFile(file_path);

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

const logAzureOcrResult = (result) => {
    result.pages.forEach((page, pageIndex) => {
        console.log(`Page # ${pageIndex}`);
        page.lines.forEach((line, lineIndex) => {
            const boundingBox = line.polygon ? line.polygon.map(point => `[${point.x}, ${point.y}]`).join(', ') : "N/A";
            console.log(`...Line # ${lineIndex} has text content '${line.content}' within bounding box '${boundingBox}'`);
        });
    });
};

const deleteFile = async (file_path) => {
    return new Promise((resolve, reject) => {
        fs.unlink(file_path, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

const convertToDUFormat = async (ocrResults, hash, feature) => {
    if (!ocrResults || !ocrResults.pages) {
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

    const tokenizer = await new Promise((resolve, reject) => {
        kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, tokenizer) => {
            if (err) reject(err);
            else resolve(tokenizer);
        });
    });

    ocrResults.pages.forEach(page => {
        page.lines.forEach(line => {
            const boundingPoly = line.polygon ? line.polygon.map(point => ({ x: point.x, y: point.y })) : [
                { x: 0, y: 0 },
                { x: feature.width, y: 0 },
                { x: feature.width, y: feature.height },
                { x: 0, y: feature.height }
            ];

            // 特定のパターンに基づいてカスタムトークン分割を行う
            const customTokens = splitCustomTokens(line.content, tokenizer);

            const lineWidth = boundingPoly[1].x - boundingPoly[0].x;
            const charWidth = lineWidth / line.content.length;

            let currentX = boundingPoly[0].x;

            customTokens.forEach(token => {
                const tokenLength = token.length * charWidth;
                const tokenBoundingPoly = [
                    { x: currentX, y: boundingPoly[0].y },
                    { x: currentX + tokenLength, y: boundingPoly[0].y },
                    { x: currentX + tokenLength, y: boundingPoly[2].y },
                    { x: currentX, y: boundingPoly[2].y }
                ];
                currentX += tokenLength;

                du_resp.responses[0].textAnnotations.push({
                    description: token,
                    score: 1,
                    type: 'text',
                    boundingPoly: {
                        vertices: tokenBoundingPoly
                    }
                });
            });

            desc += line.content + ' ';
//            console.log(`line.content # ${line.content}`);

        });
    });

    du_resp.responses[0].textAnnotations[0].description = desc.trim();

    return du_resp;
};

// カスタムトークン分割ロジック
const splitCustomTokens = (content, tokenizer) => {

    // 特定のパターンに基づいて文字列を分割する正規表現
    const patterns = [
        /([一-龥]+)\s([一-龥]+)\s\(\s(普通|当座)\s\)\s(\d+)/,
        /([一-龥]+銀行)\s([一-龥]+支店)\s(普通|当座)(\d+)/,
        /(支払期日[:：])([^\s]+)/
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
            return match.slice(1); // マッチした部分をトークンとして返す
        }
    }

    // マッチしない場合はデフォルトのトークン分割を実施
    const defaultTokens = tokenizer.tokenize(content);
    const combinedTokens = [];
    let currentToken = null;

    defaultTokens.forEach(token => {
        if (currentToken) {
            // 連続するトークンを結合するカスタムロジック
            if (isNounLike(currentToken.surface_form) && isNounLike(token.surface_form)) {
                currentToken.surface_form += token.surface_form;
            } else {
                combinedTokens.push(currentToken.surface_form);
                currentToken = token;
            }
        } else {
            currentToken = token;
        }
    });

    if (currentToken) {
        combinedTokens.push(currentToken.surface_form);
    }

    return combinedTokens;
};

// 名詞に類似するトークンの条件
const isNounLike = (surfaceForm) => {
    // 任意の名詞判定ロジックをここに追加します。
    // 簡易的な例として、ひらがな、カタカナ、漢字を名詞と見なします。
    //const nounLikePattern = /[ﾞﾟ、0-9,.\-A-Za-z@/〒。]/;
    const nounLikePattern = /[一-龥ぁ-ゔァ-ヴーｧ-ﾝﾞﾟ、0-9,.\-A-Za-z@/〒。]/;
    return nounLikePattern.test(surfaceForm);
};

module.exports = router;
