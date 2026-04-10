from flask import Flask, render_template
from .auth import auth_bp
from .sessions import sessions_bp
from .friends import friends_bp


def create_app():
    app = Flask(__name__)
    app.config.from_object("app.config.Config")

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/login")
    def login_page():
        return render_template("login.html")

    @app.get("/register")
    def register_page():
        return render_template("register.html")

    @app.get("/dashboard")
    def dashboard_page():
        return render_template("dashboard.html", active_page="dashboard")

    @app.get("/study-rooms")
    def study_rooms_page():
        return render_template("study_rooms.html", active_page="study_rooms")

    @app.get("/private-room")
    def private_room_page():
        return render_template("private_room.html", active_page="private_room")

    @app.get("/friends")
    def friends_page():
        return render_template("friends.html", active_page="friends")

    @app.get("/session/<session_id>")
    def session_page(session_id: str):
        return render_template("session.html", session_id=session_id)


    app.register_blueprint(auth_bp,      url_prefix="/api/auth")
    app.register_blueprint(sessions_bp,  url_prefix="/api")
    app.register_blueprint(friends_bp,   url_prefix="/api")

    return app