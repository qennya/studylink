from flask import Flask, render_template
from .auth import auth_bp
from .sessions import sessions_bp
from .friends import friends_bp

def create_app():
    app = Flask(__name__)
    app.config.from_object("app.config.Config")

    # Frontend pages
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
        return render_template("dashboard.html")


    @app.get("/session/<session_id>")
    def session_page(session_id: str):
        return render_template("session.html", session_id=session_id)

    @app.get("/summary/<session_id>")
    def summary_page(session_id: str):
        return render_template("summary.html", session_id=session_id)

    # API blueprints
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(sessions_bp, url_prefix="/api")
    app.register_blueprint(friends_bp, url_prefix="/api")


    return app