# Terraform Backend Configuration
# This stores your state remotely in S3 with DynamoDB locking

terraform {
  backend "s3" {
    bucket         = "cosine-terraform-state-bucket"  # Change this to a unique name
    key            = "cosine2.0/terraform.tfstate"
    region         = "us-east-1"  # Change to your preferred region
    dynamodb_table = "cosine-terraform-locks"
    encrypt        = true
  }
}
