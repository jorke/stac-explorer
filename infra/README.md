# Publish the SPA to S3 + CloudFront

This stack creates a private, encrypted, versioned S3 bucket and a public CloudFront distribution using its default HTTPS domain. CloudFront signs S3 requests with Origin Access Control; the bucket grants read access only to this distribution. S3 website hosting and public bucket access are disabled.

Extensionless paths such as `/collections/example` serve `index.html`. Static file paths are preserved, so missing JavaScript files return an error instead of HTML. Query strings such as `?url=...` remain available to React.

## Create the infrastructure

Run from the project root, using Terraform 1.7+ and an AWS CLI profile with permission to create these resources:

```sh
export AWS_PROFILE=your-profile

cp infra/terraform.tfvars.example infra/terraform.tfvars
# Optionally edit the AWS region and project name.

terraform -chdir=infra init
terraform -chdir=infra plan -out=tfplan
terraform -chdir=infra apply tfplan

terraform -chdir=infra output
```

The outputs include the bucket name, CloudFront distribution ID, and site URL. The empty site is not ready to browse until you upload the build below.

The stack uses local Terraform state by default. Keep `infra/terraform.tfstate` and its backup; they are ignored by Git. Use a separately managed remote state backend if several people will manage this stack. Commit `.terraform.lock.hcl` to retain the validated provider version.

## Configure the production basemap

Set `VITE_ALS_API_KEY`, `VITE_ALS_REGION`, and `VITE_ALS_MAP_STYLE` in `.env.production.local` (or use your existing `.env.local`). Add the CloudFront site origin returned by Terraform to the Amazon Location API key's allowed referrers. The key must be a browser map API key: Vite embeds `VITE_*` values in the published JavaScript.

Terraform does not create or change the Amazon Location key.

## Copy/paste to publish

Run this from the project root after applying Terraform. It uploads only `dist/`.

```sh
(
  set -eu

  export AWS_PROFILE=your-profile
  npm ci
  npm run build

  SITE_BUCKET="$(terraform -chdir=infra output -raw bucket_name)"
  DISTRIBUTION_ID="$(terraform -chdir=infra output -raw distribution_id)"

  # 1. Publish Vite's hashed JavaScript, CSS, workers, and other build assets.
  aws s3 sync dist/assets/ "s3://${SITE_BUCKET}/assets/" \
    --cache-control "public,max-age=31536000,immutable"

  # 2. Publish any additional public files with a short cache lifetime.
  aws s3 sync dist/ "s3://${SITE_BUCKET}/" \
    --exclude "assets/*" \
    --exclude "index.html" \
    --cache-control "public,max-age=300,must-revalidate"

  # 3. Switch the app shell only after every referenced asset is uploaded.
  aws s3 cp dist/index.html "s3://${SITE_BUCKET}/index.html" \
    --content-type "text/html; charset=utf-8" \
    --cache-control "no-cache,no-store,must-revalidate"

  # 4. Clear cached routes and wait until the new release is visible.
  INVALIDATION_ID="$(aws cloudfront create-invalidation \
    --distribution-id "${DISTRIBUTION_ID}" \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text)"

  aws cloudfront wait invalidation-completed \
    --distribution-id "${DISTRIBUTION_ID}" \
    --id "${INVALIDATION_ID}"

  terraform -chdir=infra output -raw site_url
)
```

The publish commands intentionally retain older hashed assets so open tabs can still load their workers and chunks. Uploaded cache headers control CloudFront caching; its minimum TTL is zero so the HTML `no-cache` policy is respected. A changed build gets new hashed asset names.

## Verify after publishing

```sh
SITE_URL="$(terraform -chdir=infra output -raw site_url)"
ORIGIN_URL="$(terraform -chdir=infra output -raw s3_origin_url)"

# Expect HTTP 200 and text/html for both:
curl -I "${SITE_URL}/"
curl -I "${SITE_URL}/collections/example"

# Expect HTTP 403 for direct anonymous S3 access:
curl -I "${ORIGIN_URL}/index.html"
```

S3 bucket versioning is enabled, and Terraform will refuse to destroy a nonempty bucket. Older build assets and object versions are retained until you explicitly clean them up.

## Validate locally without an AWS deployment

```sh
terraform -chdir=infra init -backend=false
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```
