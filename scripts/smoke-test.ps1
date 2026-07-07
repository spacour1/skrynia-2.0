$ErrorActionPreference = "Stop"

$api = $env:API_URL
if (-not $api) {
  $api = "http://localhost:4000"
}
$api = $api.TrimEnd("/")

function Invoke-Json($Method, $Path, $Body, [Microsoft.PowerShell.Commands.WebRequestSession]$Session) {
  $headers = @{}
  $csrfCookie = $Session.Cookies.GetCookies($api) | Where-Object { $_.Name -eq "csrf_token" } | Select-Object -First 1
  if ($csrfCookie) {
    $headers["X-CSRF-Token"] = $csrfCookie.Value
  }

  $json = $null
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 8
  }

  Invoke-RestMethod -Method $Method -Uri "$api$Path" -WebSession $Session -Headers $headers -ContentType "application/json" -Body $json
}

$buyerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$sellerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$buyer = Invoke-Json POST "/auth/login" @{ email = "buyer@example.com"; password = "Password123!" } $buyerSession
$seller = Invoke-Json POST "/auth/login" @{ email = "nova.accounts@example.com"; password = "Password123!" } $sellerSession

$categories = Invoke-Json GET "/marketplace/categories" $null $sellerSession
$categoryId = $categories.categories[0].id

$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$createdProduct = Invoke-Json POST "/marketplace/products" @{
  categoryId = $categoryId
  title = "Smoke Test Listing $suffix"
  description = "Automated smoke test listing with enough description text."
  price = "12.34"
  stock = 1
  deliveryType = "manual"
} $sellerSession

$createdOrder = Invoke-Json POST "/orders" @{ productId = $createdProduct.id; quantity = 1 } $buyerSession
$paid = Invoke-Json POST "/payments/orders/$($createdOrder.order.id)/pay" @{ provider = "mock" } $buyerSession
$started = Invoke-Json POST "/orders/$($createdOrder.order.id)/start" $null $sellerSession
$delivered = Invoke-Json POST "/orders/$($createdOrder.order.id)/deliver" @{ deliveryNote = "Smoke delivery completed." } $sellerSession
$completed = Invoke-Json POST "/orders/$($createdOrder.order.id)/confirm" $null $buyerSession
$review = Invoke-Json POST "/orders/$($createdOrder.order.id)/review" @{ rating = 5; comment = "Smoke test review." } $buyerSession

[PSCustomObject]@{
  ok = $true
  productId = $createdProduct.id
  orderId = $createdOrder.order.id
  finalStatus = $completed.order.status
} | ConvertTo-Json
