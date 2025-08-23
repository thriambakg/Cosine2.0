# Variables for OPTIONS Integration Module

variable "rest_api_id" {
  description = "The ID of the REST API Gateway"
  type        = string
}

variable "resources" {
  description = "Map of resources to create OPTIONS methods for"
  type = map(object({
    resource_id = string
  }))
}
