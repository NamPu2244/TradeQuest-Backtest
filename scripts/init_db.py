from tradequest.db import Base,engine
from tradequest import models
Base.metadata.create_all(engine)
print('Standalone Backtest database ready')
