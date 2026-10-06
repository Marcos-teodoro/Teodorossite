"""Contexto SSL compartilhado: criar um httpx.AsyncClient() novo carrega os certificados (~300 ms) a cada chamada."""
import httpx

SSL_CTX = httpx.create_ssl_context()
