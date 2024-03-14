# DU OCR Wrapper 起動に関するメモ

## 謝辞

このプロジェクトは、多くの人々の支援と励ましによって実現しました。特に、以下の方々に深い感謝を表します。

- **Kim**さんには、参考にさせていただいた[プロジェクト](https://github.com/javaos74/duocrwrapper)に関する様々な情報をご提供いただきました。ありがとうございました。

また、このプロジェクトに貢献してくださったすべての協力者に心から感謝いたします。

This project was made possible by the support and encouragement of many people. In particular, we would like to express our deepest gratitude to the following people

- **Kim**-san for providing us with various information about the [project](https://github.com/javaos74/duocrwrapper) we are referencing. Thank you very much.

We would also like to extend our sincere thanks to all the contributors who have worked on this project.

## 前提
- Visual Studio を利用します（Visual Studio Codeではありません）
  - ローカルで以下のようにクローンを実施しておく、もしくは Visual Studio のリポジトリクローンメニューより以下の URL を指定してクローンを実施しておきます。

~~~
git clone https://github.com/hnamaizawa/duocrwrapper.git
~~~

- ローカル環境で起動した DU OCR Wrapper を利用したい場合は、以下のページなどを参考に ngrok 設定を完了しておきます。
  - 参考にしたページ
    - [初めてのngrok localhost:3000を外部に公開する方法 #Webhook - Qiita](https://qiita.com/kujira_engineer/items/ce8f0f7e025324afc6b6)
    - [【プログラマー便利ツール】ngrokの使い方 | ギークの逆襲 🐟](https://www.geeklibrary.jp/counter-attack/ngrok/)
    - [ngrokとは？インストール〜公開までの手順まとめ | Miyachi Labo](https://labo.kon-ruri.co.jp/ngrok/#index_id3)

---

## DU OCR Wrapper 起動手順

- Visual Studio を起動し、DU OCR Wrapper ディレクトリ（duocrwrapper）を開きます。

- 右側のソリューション エクスプローラーに表示された duocrwrapper の右クリックメニューから `ターミナルで開く` を実行します。（PowerShellが起動します）

- 開いたターミナルで必要に応じてポート番号を変更します。（デフォルトで 3000 ポートなので必須ではありません）

~~~
$env:PORT=3000
~~~

- DU OCR Wrapper を起動します。

~~~
npm start
~~~

（補足）1回目は以下の install コマンドを実行します。

~~~
npm install
~~~

- Web ブラウザからアクセスし、以下のようなメッセージが戻されることを確認します。
  http://localhost:3000/clova


~~~
Not Found
404
NotFoundError: Not Found
    at C:\Users\hnamaizawa\source\repos\duocrwrapper\app.js:36:10
    at Layer.handle [as handle_request] (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\layer.js:95:5)
    at trim_prefix (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:328:13)
    at C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:286:9
    at Function.process_params (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:346:12)
    at next (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:280:10)
    at C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:646:15
    at next (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:265:14)
    at Function.handle (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:175:3)
    at router (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:47:12)
~~~
（補足）DU OCR Wrapper は各 OCR エンジンへのリクエストを受け付ける実装で GET でのアクセス部分を用意していないため、上記メッセージが出力されます。


- DU OCR Wrapper の停止は起動したターミナル上で Ctrl + C を実行します。

---

## ngrok 起動手順

- Windows メニューで右クリックメニューから `Windows PowerShell` を実行します。

- ターミナルから以下のよう ngrok を起動します。

~~~
ngrok http 3000
~~~

- ngrok 起動後に出力される画面から Forwarding に表示されている Endpoint をメモしておきます。

~~~
Session Status                online                                                                                    
Account                       hnamaizawa (Plan: Free)                                                                   
Version                       3.4.0                                                                                     
Region                        Japan (jp)                                                                                
Latency                       10ms                                                                                      
Web Interface                 http://127.0.0.1:4040                                                                     
Forwarding                    https://aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhhh-iiii.ngrok-free.app -> http://localhost:3000

Connections                   ttl     opn     rt1     rt5     p50     p90
                              0       0       0.00    0.00    0.00    0.00                                                                                                                             
~~~
（補足）Free 環境では ***Endpoint は毎回変わる*** ようです

- Web ブラウザから Endpoint へアクセスし、以下のメッセージが出力されることを確認します。  
  （上記の場合のURL） https://aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhhh-iiii.ngrok-free.app  
  （補足）本当に接続するか確認する画面が示された場合は [Visit Site] ボタンをクリックします。

~~~
{"message":"choose one ocr engine: /clova for Naver Clova OCR Engine, /synap for Synapsoft OCR Engine","version":"1.0.0"}
~~~

- 上記 Endpoint の後ろへ /clova を追加してアクセスすると DU OCR Wrapper 起動確認時と同じ HTTP 404 が表示されることを確認します。  
  （ここまでの手順で外部から DU OCR Wrapper へアクセス可能なことが確認できました）

~~~
Not Found
404
NotFoundError: Not Found
    at C:\Users\hnamaizawa\source\repos\duocrwrapper\app.js:36:10
    at Layer.handle [as handle_request] (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\layer.js:95:5)
    at trim_prefix (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:328:13)
    at C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:286:9
    at Function.process_params (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:346:12)
    at next (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:280:10)
    at C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:646:15
    at next (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:265:14)
    at Function.handle (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:175:3)
    at router (C:\Users\hnamaizawa\source\repos\duocrwrapper\node_modules\express\lib\router\index.js:47:12)
~~~

（参考）ngrok サイトでドメインを固定する設定(無料)を実施すると以下のように ngrok 起動時にドメイン名が指定可能となり、毎回同じ URL でアクセスできるようになります。

~~~
ngrok http --domain=aaaaaaa-bbbbbbb-cccc.ngrok-free.app 3000
~~~

- ngrok の停止は起動したターミナル上で Ctrl + C を実行します

（参考）ngrok は外部からローカルのサービスへのアクセスを可能にするため、検証作業が終了したら直ぐに ngrok を停止しておきます。

---
