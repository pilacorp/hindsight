"""NDA multi-user Hindsight extension.

A database-backed tenant extension (per-user API keys -> isolated PostgreSQL
schema) plus an HTTP extension for admin/user management. Ships by copying this
package into an image derived from Hindsight; see the Dockerfile.
"""
