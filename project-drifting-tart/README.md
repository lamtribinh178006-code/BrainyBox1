# BrainyBox — prototype mua và thuê đồ chơi

Bộ prototype static bằng HTML, Tailwind CSS v4 Browser CDN và JavaScript thuần. Không cần cài package hay chạy build.

## Các trang

- `index.html` — trang chủ, 5 danh mục hoạt động theo bảng phân loại, catalog 19 sản phẩm và form tư vấn B2B; bố cục tối đa 1.440px, 5 cột ở màn hình desktop rộng.
- `category.html?id=<slug>` — danh sách sản phẩm theo danh mục: `movement`, `learning-story`, `stem-logic`, `group-games`, `puzzles`. Workbook phân nhóm 19 sản phẩm; dòng số 11 để trống nên không có sản phẩm cho dòng này.
- `product.html` — chi tiết sản phẩm theo `?id=...`, có mua đứt hoặc thuê 14 ngày nếu bảng nguồn cho phép.
- `checkout.html` — thông tin giao hàng, phương thức thanh toán mô phỏng và tổng kết giỏ hàng; không gửi dữ liệu hoặc thu tiền thật.
- Catalog giữ các tên thương hiệu trong bảng; tài liệu cũng có ghi chú đầu trang về chỉ nhập Mideer, nên nhóm cần xác nhận nguồn hàng cuối cùng.
- `about.html` — câu chuyện, mô hình kinh doanh và nhóm khách hàng BrainyBox.
- `policies.html` — bản tóm lược dự thảo chính sách dựa trên tài liệu dự án.

## Chạy thử

Mở `index.html` trong trình duyệt; từ trang sản phẩm thêm món vào giỏ, chọn **Thanh toán** để mở `checkout.html`. Checkout dùng địa chỉ và phương thức thanh toán mô phỏng; dữ liệu liên hệ không được lưu, gửi hoặc tính tiền.

Cần kết nối internet để tải Tailwind Browser CDN, Google Fonts và ảnh ngoài. Giá, giỏ hàng và form tư vấn chỉ là dữ liệu mô phỏng phía trình duyệt; không có thanh toán hoặc API backend. Chính sách là nội dung dự thảo, cần nhóm rà soát và phê duyệt trước khi áp dụng thực tế.
