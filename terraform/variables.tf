variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "test_root_bucket_name" {
  description = "Test bucket identifier"
  type        = string
}

variable "environment" {
  description = "Environment name (staging or production)"
  type        = string
}

variable "bucketname" {
  description = "Name of the S3 bucket"
  type        = string
}