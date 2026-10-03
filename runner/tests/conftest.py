from azure.ai.agentserver.invocations import InvocationAgentServerHost

_original_init = InvocationAgentServerHost.__init__


def _test_init(self, **kwargs):
    kwargs["configure_observability"] = None
    _original_init(self, **kwargs)


InvocationAgentServerHost.__init__ = _test_init
