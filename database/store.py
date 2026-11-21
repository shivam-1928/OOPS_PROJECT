"""Transactional SQLite adapter for Java. Protocol fields are UTF-8/base64."""
import base64
from pathlib import Path
import sqlite3
import sys

tables = ("accounts", "skills", "incidents", "audit", "notifications", "information_requests", "information_replies")

def encode(value):
    return "-" if value is None else base64.b64encode(str(value).encode()).decode()

def decode(value):
    return None if value == "-" else base64.b64decode(value, validate=True).decode()

def main():
    action, path = sys.argv[1:3]
    db = sqlite3.connect(path)
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(Path(__file__).with_name("schema.sql").read_text())
    db.execute("BEGIN IMMEDIATE")
    with db:
        if not db.execute("SELECT 1 FROM revision").fetchone():
            db.execute("INSERT INTO revision VALUES(0)")
        version, = db.execute("SELECT version FROM revision").fetchone()
        if action == "load":
            print(version)
            for table in tables:
                for row in db.execute(f"SELECT * FROM {table} ORDER BY rowid"):
                    print(table, *map(encode,row), sep="\t")
        elif action == "save":
            if version != int(sys.stdin.readline()):
                raise RuntimeError("STORAGE_CONFLICT: Database changed in another process. Reload before retrying.")
            for table in reversed(tables):
                db.execute(f"DELETE FROM {table}")
            for line in sys.stdin:
                table, *fields = line.rstrip("\n").split("\t")
                if table not in tables:
                    raise ValueError("Unknown table")
                db.execute(f"INSERT INTO {table} VALUES({','.join('?' for _ in fields)})",
                           tuple(map(decode, fields)))
            db.execute("UPDATE revision SET version=version+1")
        else:
            raise ValueError("Unknown operation")
    db.close()

if __name__ == "__main__":
    main()
