# modules/lambda-layer/variables.tf

variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment (staging, production, etc.)"
  type        = string
}
