from tradequest.db import Base,engine,migrate_local
from tradequest import models
migrate_local()
Base.metadata.create_all(engine)
print('Standalone Backtest database ready')
