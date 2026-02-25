from pymongo import MongoClient
from .config import Config

_client = None

def get_db():
    global _client
    if _client is None:
        if not Config.MONGO_URI:
            raise RuntimeError("MONGO_URI is not set. Add it to your .env file.")
        _client = MongoClient(Config.MONGO_URI)
    return _client[Config.MONGO_DB_NAME]