# Engine Match Server — thiết kế

## Mục đích

Một website client-server để **hai người khác nhau đấu engine cờ với nhau** (Gomoku/Caro). Mỗi người chạy engine trên máy mình; server
chủ trì trận đấu và làm trọng tài. Người xem mở link để xem trực tiếp. Mục tiêu là so sánh công bằng hai engine, không phải chơi cờ với người.

## Mục tiêu / Không mục tiêu / Điều phải tránh

**Mục tiêu**
- Trận gồm N ván, đổi bên đi trước, mỗi khai cuộc chơi một cặp ván đổi bên.
- Server là nguồn sự thật duy nhất: bàn cờ, đồng hồ, nước đi hợp lệ, kết quả.
- Chạy công khai trên internet từ đầu (HTTPS/WSS).
- Xem lại ván và xuất kết quả sau trận.

**Không mục tiêu (phiên bản đầu)**
- Quá 2 người chơi mỗi trận; giải vòng tròn hay loại trực tiếp nhiều người.
- Tài khoản, mật khẩu, bảng xếp hạng toàn cục.
- Luật Renju, Swap/Swap2, và các luật mở rộng của Rapfi (tường, cổng, torus).
- Chạy engine trên server.

**Điều phải tránh**
- Tin vào kết quả hay thời gian do engine/agent tự báo.
- Để một ván treo vĩnh viễn khi một bên rớt mạng.
- Cho người lạ vào chiếm chỗ người chơi của phòng.

## Ràng buộc

- Server **Node.js**. Giao diện web: script cổ điển không build, như `GomokuBoardSite` (`window.Gomoku`), tái sử dụng bàn cờ `js/board.js`, `js/game.js`. *(Lựa chọn của tôi: giữ cách này để dùng lại được code bàn cờ; dùng bundler chỉ khi cần.)*
- Trình duyệt không chạy được engine nội bộ của người chơi, nên mỗi người chạy một **agent cục bộ** (chương trình nhỏ) khởi chạy engine và kết nối **ra** server qua WebSocket. Mô hình tham khảo: `HTML/extension_vncaro/server/bridge/` (`EngineAdapter` trong `ports.py`, `Session`, `adapters/gomocup.py`, `adapters/rapfi.py`); ở đây đảo chiều (agent là client). Agent có thể viết bằng Node hoặc Python — để người xây quyết định *(mặc định của tôi: Node, một ngôn ngữ cho cả dự án)*.
- Giao thức engine: Gomocup/Piskvork + mở rộng Yixin/Rapfi, mô tả đầy đủ ở `C++/Project/Lab/Rapfi_V3_PTR/dev/rapfi/Rapfi/docs/protocol.md`. Điểm cần nhớ: khi engine đang nghĩ nó bỏ qua mọi lệnh trừ `STOP`/`YXSTOP`/`END`, và Rapfi trả **đúng một dòng nước đi cho mỗi lần tìm kiếm** kể cả khi bị dừng.
- Hội thoại với người dùng và chuỗi giao diện: tiếng Việt mặc định, tiếng Anh thứ hai (mọi chuỗi qua một file i18n, như `GomokuBoardSite`).

## Những gì người dùng đã quyết

- **Người chơi:** hai người thật, hai máy khác nhau.
- **Định dạng:** match N ván, đổi bên đi trước; khai cuộc lấy từ danh sách có sẵn, mỗi khai cuộc đấu 2 ván đổi bên.
- **Triển khai:** internet công khai từ đầu.
- **Server:** Node.js. **Lưu trữ:** SQLite trên server.
- **Luật:** ba luật riêng biệt — Standard, Freestyle, Caro (xem mục "Luật" về cách hiểu).
- **Bàn cờ:** cỡ m×n (chữ nhật).
- **Đồng hồ:** thời gian cả ván + giới hạn mỗi nước (kiểu Gomocup `timeout_match`/`timeout_turn`), server tự đo.
- **Danh tính:** link phòng + mã bí mật, không tài khoản.
- **Mất kết nối giữa ván:** chờ nối lại trong N giây (đồng hồ ván vẫn chạy); hết hạn thì xử thua.
- **Engine không hỗ trợ luật/bàn của phòng:** từ chối ngay lúc bấm "sẵn sàng", báo lý do, không cho vào trận.

## Câu trả lời sau bước kiểm tra thiết kế

- **Độ trễ mạng tính cho người chơi.** Đồng hồ của một bên chạy từ lúc server gửi `go` đến lúc server nhận nước đi. Quá `timeout_turn` hoặc hết `timeout_match` thì thua; hết `timeout_match` giữa lượt cũng thua. Không bù ping, không ân hạn.
- **Hỗ trợ cả engine Gomocup cổ điển** (người dùng chọn, không phải mặc định của tôi). Nhiều engine bỏ qua lặng lẽ lệnh `INFO` lạ nên `OK`/`ERROR` không đủ tin cậy. Do đó: (a) agent đọc `ABOUT` để nhận diện engine; (b) engine được xếp là **Rapfi-protocol** (có thể chạy mọi luật, bàn chữ nhật) hoặc **Gomocup-classic** (chỉ bàn vuông, chỉ Freestyle được đảm bảo; Standard/Caro/chữ nhật bị từ chối vì server không thể biết engine có hiểu luật hay không); (c) với engine classic, trọng tài của server vẫn xử thắng theo luật của phòng — nước 6+ của engine vẫn bị trọng tài chấp nhận ở Freestyle. Cách nhận diện cụ thể để người xây quyết định, với nguyên tắc: không chắc thì từ chối.
- **Khai cuộc:** người tạo phòng dán danh sách; mỗi khai cuộc là một dãy toạ độ `x,y`, kiểm tra hợp lệ với cỡ bàn khi tạo phòng. Mỗi khai cuộc đấu 2 ván đổi bên; nếu N lẻ thì khai cuộc cuối chỉ đấu một ván. Các quân khai cuộc tính vào số thứ tự nước (ply) và vào lượt đi.

## Luật

Trọng tài của server **phải khớp đúng định nghĩa của Rapfi** để hai bên engine và trọng tài không bất đồng. Theo `protocol.md` §6.2:

| Luật của trang | `INFO RULE` | Cách tính thắng |
| :--- | :--- | :--- |
| Freestyle | `0` | 5 quân trở lên liên tiếp |
| Standard | `1` | đúng 5 quân (hàng 6+ không tính) |
| Caro | `8` (Free Caro) | 6+ thắng; đúng 5 thắng trừ khi **cả hai** ô liền kề hai đầu là quân đối thủ; cạnh bàn và ô chặn không tính là chặn |

*(Lựa chọn của tôi: "Caro" = Free Caro của Rapfi, vì đó là biến thể Caro duy nhất trong tài liệu engine. Nếu người dùng muốn luật Caro Việt Nam khác thì thay định nghĩa, và engine phải hỗ trợ.)* Rapfi từ chối `RULE 8` với khai cuộc Swap2; phiên bản đầu không dùng Swap nên không xung đột.

Bàn m×n dùng `RECTSTART w,h` (mỗi cạnh 5..22). Bàn chữ nhật dùng bộ đánh giá cổ điển, không có NNUE; cần agent kiểm tra engine có chấp nhận `RECTSTART` (xem "Kiểm tra khả năng tương thích").

## Kiến trúc

```
Player A: engine <-stdio-> agent A --WSS--\
                                           server (phòng, trọng tài, đồng hồ, SQLite) --WSS--> trình duyệt (bàn cờ, người xem)
Player B: engine <-stdio-> agent B --WSS--/
```

**Server** quản lý: phòng, token người chơi, vòng đời trận, từng ván (bàn cờ chuẩn, lượt, đồng hồ, kết thúc), phát sự kiện cho người xem, lưu SQLite.

**Agent** quản lý: khởi chạy/dừng engine, dịch lệnh server → lệnh engine và dòng engine → sự kiện (một adapter Gomocup/Rapfi, theo mẫu `EngineAdapter`), tôn trọng quy tắc "đang nghĩ thì chỉ nhận STOP".

**Trình duyệt:** trang tạo phòng, trang phòng (chờ, sẵn sàng, cài đặt), trang xem trận (bàn cờ trực tiếp, đồng hồ, danh sách nước, tỷ số, thông tin engine tuỳ chọn), trang xem lại.

## Vòng đời

1. Người tạo phòng đặt: luật, cỡ bàn m×n, N ván, thời gian cả ván và mỗi nước, danh sách khai cuộc, N giây chờ nối lại. Server trả hai link người chơi (A và B, mỗi link mang token bí mật) và một link xem. *(Đoán của tôi: người tạo phòng được phép là một trong hai người chơi bằng cách dùng link A của chính phòng đó.)*
2. Mỗi người mở link, chạy agent với token. Agent kết nối WSS và gửi thông tin engine (tên, phiên bản, giới hạn bàn).
3. Mỗi bên bấm **sẵn sàng**. Agent chạy thử cấu hình (`START`/`RECTSTART`, `INFO RULE`, `OK`/`ERROR`); lỗi → từ chối kèm lý do.
4. Khi cả hai sẵn sàng: server chạy từng ván. Mỗi ván: gửi cho bên đến lượt *vị thế đầy đủ* (khai cuộc + các nước đã đi) và thời gian còn lại; nhận một nước; kiểm tra (ô trống, trong bàn, đúng lượt, đúng thời gian); phát cho người xem; kiểm tra thắng/hoà/hết giờ.
5. Hết ván → lưu SQLite → ván kế (đổi bên). Hết N ván → trận kết thúc, hiện W/D/L và tuỳ chọn xuất file.

## Giao thức agent ↔ server

JSON qua WebSocket. Hướng đề xuất (gần với `engine_server.py` hiện có, *chi tiết thông điệp để người xây quyết định*):

- agent → server: `hello{token, engine, limits}`, `ready{ok, reason?}`, `move{gameId, ply, x, y}`, `info{...}` (tuỳ chọn, để hiển thị), `log`.
- server → agent: `config{rule, w, h, timeouts}`, `go{gameId, ply, stones[], toMove, timeLeftMs, turnMs}`, `stop`, `gameOver{result}`, `ping`.

Nguyên tắc: gửi **vị thế đầy đủ** mỗi lượt (như bridge hiện có) để agent không phải giữ trạng thái; mỗi `go` đúng một `move` trả lời; nước đi trễ hoặc sai `ply` bị bỏ qua.

## Kiểm tra khả năng tương thích

Lúc "sẵn sàng", agent thử `START`/`RECTSTART`, `INFO RULE`, `INFO TIMEOUT_TURN`, `INFO TIMEOUT_MATCH` và đọc `OK`/`ERROR` (không có handshake nào khác). Bất kỳ `ERROR` nào → từ chối, nêu lệnh nào lỗi. Engine Gomocup thuần chỉ nhận bàn vuông.

## Bảo mật (chạy công khai)

- Token ngẫu nhiên đủ dài, chỉ trao qua link; một token chỉ cho một kết nối agent tại một thời điểm (kết nối mới thay thế cũ trong thời gian chờ nối lại).
- WSS/HTTPS bắt buộc ở môi trường công khai.
- Server không tin agent: kiểm tra mọi nước, tự đo thời gian, giới hạn kích thước thông điệp và tần suất, giới hạn số phòng mỗi IP.
- Người xem không có quyền gửi nước đi.
- Engine chạy trên máy người chơi, ngoài phạm vi tin cậy của server.

## Lưu trữ

SQLite: phòng, người chơi (tên + engine), cấu hình, ván, nước đi có thời gian, kết quả. Xuất JSON một ván/một trận. *(Định dạng PGN để người xây quyết định.)*

## Để người xây quyết định

- Chọn framework HTTP/WebSocket Node, cách đóng gói agent, cấu trúc thư mục, định dạng thông điệp chi tiết.
- Cách chọn lại nước/ván khi agent nối lại giữa ván (gửi lại `go` với thời gian còn lại hiện tại là hướng hợp lý).
- Giá trị mặc định N giây chờ nối lại, giới hạn thời gian, số phòng tối đa.
- Cách tái sử dụng hoặc sao chép `board.js`/`game.js` (cần lược bỏ cây biến thể nếu không dùng).
- Hiển thị thông tin tìm kiếm của engine cho người xem (độ sâu, đánh giá, PV): tuỳ chọn, không bắt buộc.

## Quyết định của tôi (người xây có thể đổi nếu có lý do)

- **Engine giữa các ván:** agent giữ một tiến trình engine suốt trận; mỗi `go` bắt đầu bằng `RESTART` rồi `YXBOARD`/`BOARD` đầy đủ. Một máy trạng thái chặt cho mỗi lần tìm kiếm: mọi `STOP` phải chờ đủ **một** dòng nước đi trước khi gửi lệnh tiếp. Nếu engine không phản hồi sau thời gian ân hạn, agent khởi động lại tiến trình.
- **Kết thúc ván khi engine đang nghĩ** (đối thủ rớt mạng, hết giờ, thắng): server gửi `stop` + `gameOver`; agent dừng engine, nuốt dòng nước đi còn sót, bỏ kết quả.
- **Mất kết nối:** đồng hồ nước đi của bên đó vẫn chạy; nếu hết giờ trước khi nối lại thì thua do hết giờ, nếu cửa sổ N giây hết trước thì thua do rớt mạng. Nước đi tới muộn sau khi ván kết thúc bị bỏ. Vắng mặt giữa các ván: ván kế bắt đầu khi cả hai kết nối; chờ quá N giây thì bên vắng bị xử thua ván đó.
- **Trọng tài thắng/thua:** viết mới bằng Node, **không** dùng `game.js` làm trọng tài (nó không có phát hiện thắng). Kiểm thử bằng cách đối chiếu với Rapfi trên các vị thế ngẫu nhiên và các trường hợp biên của Free Caro (cạnh bàn, hàng 6+, chặn một đầu).
- **Phòng công khai:** phòng hết hạn sau 24 giờ không hoạt động; người tạo xoá được phòng; hai link người chơi chỉ hiện một lần cho người tạo, link xem không lộ token; tối đa 5 phòng đang mở mỗi IP *(con số mặc định, đổi được)*.
- **Agent:** CLI nhận đường dẫn engine và token, chạy engine với thư mục của chính engine làm thư mục làm việc (như bridge hiện có để nạp `config.toml` và mô hình). Hỗ trợ Linux/macOS/Windows nếu `child_process` làm được mà không tốn công.
- **Bàn chữ nhật:** nếu engine của một bên không nhận `RECTSTART`, bên đó bị từ chối lúc sẵn sàng; người tạo phòng được cảnh báo trên trang tạo phòng rằng bàn chữ nhật cần engine kiểu Rapfi.

## Quy ước tài liệu

Bố cục `docs/` theo `HTML/extension_vncaro/docs/` (adr, todo, fix-log, knowledge, notes, templates). Thư mục này không phải git repo nên tài liệu chưa được commit.
