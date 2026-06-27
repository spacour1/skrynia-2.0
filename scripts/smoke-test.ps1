$ErrorActionPreference = "Stop"

$api = $env:API_URL
if (-not $api) {
  $api = "http://localhost:4000"
}

function Invoke-Json($Method, $Path, $Body, $Token) {
  $headers = @{}
  if ($Token) {
    $headers.Authorization = "Bearer $Token"
  }
  $json = $null
  if ($Body) {
    $json = $Body | ConvertTo-Json -Depth 8
  }
  Invoke-RestMethod -Method $Method -Uri "$api$Path" -Headers $headers -ContentType "application/json" -Body $json
}

$buyer = Invoke-Json POST "/auth/login" @{ email = "buyer@example.com"; password = "Password123!" } $null
$seller = Invoke-Json POST "/auth/login" @{ email = "seller@example.com"; password = "Password123!" } $null

$categories = Invoke-Json GET "/marketplace/categories" $null $seller.token
$categoryId = $categories.categories[0].id

$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$createdProduct = Invoke-Json POST "/marketplace/products" @{
  categoryId = $categoryId
  title = "Smoke Test Listing $suffix"
  description = "Automated smoke test listing with enough description text."
  price = "12.34"
  stock = 1
  deliveryType = "manual"
} $seller.token

$createdOrder = Invoke-Json POST "/orders" @{ productId = $createdProduct.id; quantity = 1 } $buyer.token
$paid = Invoke-Json POST "/payments/orders/$($createdOrder.order.id)/pay" @{ provider = "mock" } $buyer.token
$started = Invoke-Json POST "/orders/$($createdOrder.order.id)/start" $null $seller.token
$delivered = Invoke-Json POST "/orders/$($createdOrder.order.id)/deliver" @{ deliveryNote = "Smoke delivery completed." } $seller.token
$completed = Invoke-Json POST "/orders/$($createdOrder.order.id)/confirm" $null $buyer.token
$review = Invoke-Json POST "/orders/$($createdOrder.order.id)/review" @{ rating = 5; comment = "Smoke test review." } $buyer.token

[PSCustomObject]@{
  ok = $true
  productId = $createdProduct.id
  orderId = $createdOrder.order.id
  finalStatus = $completed.order.status
} | ConvertTo-Json
