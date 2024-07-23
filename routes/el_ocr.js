var express = require('express');
var router = express.Router();
var debug = require('debug')('http')
var fs = require('fs');
const crypto = require('crypto');
const nconf = require('nconf')
const axios = require('axios');
const bodyParser = require('body-parser');
const kuromoji = require('kuromoji');

const detect_angle = function( rotation) {
    let rot = rotation <0 ? 0 - rotation : 360 - rotation;
    if ( rot >= 360-45 || rot < 45)
        return 0;
    else if ( rot >= 45 || rot < 90+45)
        return 90;
    else if ( rot >= 90+45 || rot < 180-45)
        return 180;
    else 
        return 270;
}

nconf.file( {file: './routes/config.json'});

/* OCR Endpoint 基本情報 (OCR Endpoint Basic Information) */
router.get('/info/model', function(req,res,next) {
  const info = {
        accents:false,
        commit:"309c4703a92d41ca08d470955f0e253b416b151b",
        gpu:false,
        model:"du-ocr",
        rotation_detection:true,
        version:"1.0.0"
      }
  res.send( info);
});

router.get('/config', function (req, res, next) {
    const cfg = {
        el_ocr: {
            endpoint: nconf.get("el_ocr:endpoint"),
            lang: nconf.get('lang') || 'ja'
        }
    };
    res.send(cfg);
});

router.put('/config', function (req, res, next) {
    let _changed = 0;
    if (req.body.el_ocr && req.body.el_ocr.endpoint) {
        nconf.set("el_ocr:endpoint", req.body.el_ocr.endpoint);
        nconf.save();
        _changed = 1;
    }
    if (req.body.el_ocr && req.body.el_ocr.lang) {
        nconf.set("el_ocr:lang", req.body.el_ocr.lang);
        nconf.save();
        _changed = 1;
    }
    if (_changed) {
        res.sendStatus(200);
    } else {
        res.status(404).send("no el_ocr.endpoint ");
    }
});

/* POST body listing. */
router.post('/', async function (req, res, next) {
    const ELOCR_endpoint = process.env.ELOCR_ENDPOINT || nconf.get("el_ocr:endpoint");
    res.writeContinue();
    var hash = crypto.createHash('md5').update(req.body.requests[0].image.content).digest('hex');
    let buff = Buffer.from(req.body.requests[0].image.content, "base64");

    const options = {
        method: 'POST',
        url: ELOCR_endpoint + "/vision/v3.2/read/analyze",
        headers: {
            'Content-Type': 'application/octet-stream',
            'x-uipath-license': process.env.ELOCR_API_KEY || req.headers['x-uipath-license']
        },
        data: buff
    };

    const tokenizer = await new Promise((resolve, reject) => {
        kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, tokenizer) => {
            if (err) reject(err);
            else resolve(tokenizer);
        });
    });

    try {
        const analyzeResponse = await axios(options);
//        console.log(`URL # ${options.url} : APIKEY # ${req.headers['x-uipath-license']}`);
//        console.log(`resp.data # ${analyzeResponse.data}`);

        if (analyzeResponse.status !== 202) {
            return res.status(analyzeResponse.status).send(analyzeResponse.data);
        }

        const operationLocation = analyzeResponse.headers['operation-location'];
//        console.log(`operationLocation # ${operationLocation}`);
        if (!operationLocation) {
            return res.status(500).send("No operation location found in response headers");
        }

        // Poll for result
        setTimeout(async function () {
            const resultOptions = {
                method: 'GET',
                url: operationLocation,
                headers: {
                    'x-uipath-license': process.env.ELOCR_API_KEY || req.headers['x-uipath-license']
                }
            };

            try {
                const resultResponse = await axios(resultOptions);

                if (resultResponse.status !== 200) {
                    console.log(resultResponse.data);
                    return res.status(resultResponse.status).send(resultResponse.data);
                }

                const elocr = resultResponse.data;
                debug("EL OCR response: " + elocr);

                var du_resp = {
                    responses: [
                        {
                            angle: detect_angle(elocr.analyzeResult.readResults[0].angle),
                            textAnnotations: [
                                {
                                    description: '',
                                    score: 0,
                                    type: 'text',
                                    image_hash: hash,
                                    boundingPoly: {
                                        vertices: [
                                            { x: 0, y: 0 },
                                            { x: elocr.analyzeResult.readResults[0].width, y: 0 },
                                            { x: elocr.analyzeResult.readResults[0].width, y: elocr.analyzeResult.readResults[0].height },
                                            { x: 0, x: elocr.analyzeResult.readResults[0].height },
                                        ]
                                    }
                                }
                            ]
                        }
                    ]
                };
                var full_text = ''
                var score_sum = 0.0

                let combinedWords = [];

                const isJapaneseCharacterOrDate = (str) => {
                    // ここへ単語として結合したくない文字列パターンの正規表現を指定します
                    // Specify here a regular expression for a string pattern that you do not want to combine as a word
                    const excludePatterns = [
                        /^社員番号\s{0,10}\d{6}$/, // 「社員番号」+ 空白0～10文字 + 数字6桁
                        /^自\s{0,10}\d{2}$/,       // 「自」+ 空白0～10文字 + 数字2桁
                        /^至\s{0,10}\d{2}$/        // 「至」+ 空白0～10文字 + 数字2桁
                    ];
                    // 除外パターンにマッチする場合は false を返す
                    // Returns false if the exclusion pattern is matched
                    for (const pattern of excludePatterns) {
                        if (pattern.test(str)) {
                            return false;
                        }
                    }
                    return /^[\d]{4}年$/.test(str) || /^[\d]{2}(月|日)$/.test(str) || /[\u3000-\u30FF\u4E00-\u9FFF\uFF66-\uFF9F]/.test(str) || /^[\d]{4}$/.test(str);
                };

                // 座標が近い文字を結合
                // Combine characters with close coordinates
                elocr.analyzeResult.readResults[0].lines.forEach(line => {
                    line.words.forEach(word => {
                        const lastWord = combinedWords[combinedWords.length - 1];
                        const currentCharacter = word.text;

                        // 最後の文字が日本語、または「年」「月」「日」の前に4ケタまたは2ケタの数字がある場合
                        // If the last character is Japanese or there are 4 digits or 2 digits before "year", "month", or "day".
                        if (lastWord &&
                            (isJapaneseCharacterOrDate(lastWord.description) &&                     // 最後の文字が日本語、または日付の確認（Last character is Japanese or date confirmation）
                             isJapaneseCharacterOrDate(lastWord.description + currentCharacter))) { // 新しい文字を結合しても除外パターンにマッチしないかの確認（Checking that the new character concatenation does not match the exclusion pattern）

                            const d = word.boundingBox[0] - lastWord.boundingPoly.vertices[1].x;
                            const avgHeight = (lastWord.boundingPoly.vertices[2].y - lastWord.boundingPoly.vertices[1].y + word.boundingBox[5] - word.boundingBox[3]) / 2;
                            const ratio = avgHeight > 0 ? d / avgHeight : 1;

                            // 縦横の比率が 0.8 より低いか
                            // Is the ratio of length to width less than 0.8?
                            if (Math.abs(ratio) < 0.8) { 
                                // 条件を満たせば文字と領域を結合
                                // Combine text and area if conditions are met
                                lastWord.description += currentCharacter;
                                lastWord.score = (lastWord.score + word.confidence) / 2;
                                lastWord.boundingPoly.vertices[1].x = Math.max(lastWord.boundingPoly.vertices[1].x, word.boundingBox[2]); // コピー元とコピー先で比較し、大きい値を利用する（以下の3行も同じ）
                                lastWord.boundingPoly.vertices[2].x = Math.max(lastWord.boundingPoly.vertices[2].x, word.boundingBox[4]); // Compare the source and destination and use the larger value (same for the following three lines)
                                lastWord.boundingPoly.vertices[2].y = Math.max(lastWord.boundingPoly.vertices[2].y, word.boundingBox[5]);
                                lastWord.boundingPoly.vertices[3].y = Math.max(lastWord.boundingPoly.vertices[3].y, word.boundingBox[7]);
                            } else {
                                // 新しい単語として追加
                                // Add as new word
                                combinedWords.push({
                                    description: word.text,
                                    score: word.confidence,
                                    type: 'text',
                                    boundingPoly: {
                                        vertices: [
                                            { x: word.boundingBox[0], y: word.boundingBox[1] },
                                            { x: word.boundingBox[2], y: word.boundingBox[3] },
                                            { x: word.boundingBox[4], y: word.boundingBox[5] },
                                            { x: word.boundingBox[6], y: word.boundingBox[7] }
                                        ]
                                    }
                                });
                            }
                        } else {
                            // 新しい単語として追加
                            // Add as new word
                            combinedWords.push({
                                description: word.text,
                                score: word.confidence,
                                type: 'text',
                                boundingPoly: {
                                    vertices: [
                                        { x: word.boundingBox[0], y: word.boundingBox[1] },
                                        { x: word.boundingBox[2], y: word.boundingBox[3] },
                                        { x: word.boundingBox[4], y: word.boundingBox[5] },
                                        { x: word.boundingBox[6], y: word.boundingBox[7] }
                                    ]
                                }
                            });
                        }
                    });
                });

                // 結合したテキストをTokenaizerで意味のある単語へ分割し、分割した単語で名詞などが続くようなら再度結合する（住所などをより大きなテキストとして結合するため）
                // この時、splitCustomTokens関数から戻された単語にマッチするように領域も文字数で均等分割しているがフォントなどで位置情報が多少ずれる場合がある
                // The combined text is split into meaningful words using Tokenaizer, and if the split words are followed by nouns, etc., they are combined again (to combine addresses, etc. as larger text).
                // At this time, the area is equally divided by the number of characters to match the words returned from the splitCustomTokens function, but the positional information may shift slightly due to fonts, etc. 
                let finalWords = [];
                combinedWords.forEach(word => {
                    const tokens = splitCustomTokens(word.description, tokenizer);

                    const lineWidth = word.boundingPoly.vertices[1].x - word.boundingPoly.vertices[0].x;
                    const charWidth = lineWidth / word.description.length;
                    let currentX = word.boundingPoly.vertices[0].x;

                    tokens.forEach(token => {
                        const tokenLength = token.length * charWidth;
                        const tokenBoundingPoly = [
                            { x: currentX, y: word.boundingPoly.vertices[0].y },
                            { x: currentX + tokenLength, y: word.boundingPoly.vertices[0].y },
                            { x: currentX + tokenLength, y: word.boundingPoly.vertices[2].y },
                            { x: currentX, y: word.boundingPoly.vertices[2].y }
                        ];
                        currentX += tokenLength;

                        finalWords.push({
                            description: token,
                            score: word.score,
                            type: 'text',
                            boundingPoly: {
                                vertices: tokenBoundingPoly
                            }
                        });
                    });
                });

                finalWords.forEach(word => {
                    du_resp.responses[0].textAnnotations.push(word);
                    full_text += word.description + ' ';
                    score_sum += word.score;
                });

                // 全体のtextの値を提供していないため、wordsの値を全て合算します
                // aggregate all values of words, since the value of the whole text is not provided
                du_resp.responses[0].description = full_text.trim();
                // 平均score値を計算
                // Calculate average score value
                du_resp.responses[0].score = score_sum / du_resp.responses[0].textAnnotations.length;
                res.send(du_resp);

            } catch (error) {
                console.error('Error getting the analysis result:', error);
                res.status(500).send('Error getting the analysis result');
            }

        }, 5000); // Adjust the timeout as needed to allow the OCR processing to complete

    } catch (error) {
        console.error('Error analyzing the image:', error);
        res.status(500).send('Error analyzing the image');
    }
});

// tokenizer分割ロジック
// tokenizer splitting logic
const splitCustomTokens = (content, tokenizer) => {

    const defaultTokens = tokenizer.tokenize(content);

//console.log(`content: ${content}`);
//console.log('');
//defaultTokens.forEach(token => {
//   console.log(`tokenize surface form:   ${token.surface_form}`);
//   console.log(`tokenize part of speech: ${token.pos}`);
//   console.log('------');
//});

    const combinedTokens = [];
    let currentToken = null;

    defaultTokens.forEach(token => {
        if (currentToken) {
            // 連続するトークンを結合するカスタムロジック
            // 名詞などが続くようなら再度結合する（住所などをより大きなテキストとして結合するため）
            // Re-join nouns, etc. if they follow (to join addresses, etc. as larger text)
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

//combinedTokens.forEach(token => {
//    console.log(`Combined Tokens result # ${token}`);
//});
//console.log('');

    return combinedTokens;
};

// 名詞が続いているかのチェック処理
// Checking process to see if nouns are followed
const isNounLike = (surfaceForm) => {
    // 任意の名詞判定ロジックをここに追加します。
    // 簡易的な例として、ひらがな、カタカナ、漢字、英数、一部の記号を名詞と見なします。
    // Add arbitrary noun determination logic here.
    // As a simplified example, hiragana, katakana, kanji, alphanumeric characters, and some symbols are considered nouns.
    const nounLikePattern = /[一-龥ぁ-ゔァ-ヴーｧ-ﾝﾞﾟ、0-9,.\-A-Za-z@/〒。]/;
    return nounLikePattern.test(surfaceForm);
};

module.exports = router;
