// @flow
import React, { Component } from 'react'
import {
  Button,
  Card,
  Form,
  TextArea,
} from 'semantic-ui-react'

class NewList extends Component {
  props: {
    match: {
      params: {
        id: string,
      },
    },
  }

  state = {
    input: '',
  }

  changeInput = (e: SyntheticInputEvent) =>
    this.setState({ input: e.target.value })

  save = (e: SyntheticEvent) => {
    e.preventDefault()
    const { input } = this.state
    fetch('/api/v1/list', { method: 'POST', body: (new FormData()).append('list', input) })
      .then(res => res.json())
      .then(res => window.location.href = `/#/view/${res.body.body.id}`) // eslint-disable-line no-return-assign
  }

  render() {
    return (
      <Form action="/api/v1/list" method="POST" onSubmit={this.save}>
        <div style={{ padding: '10px' }}>
          <Card fluid>
            <Card.Header>
              <h1 style={{ padding: '3px 15px' }}>New</h1>
            </Card.Header>
            <Card.Content>
              <TextArea
                id="markdown_textarea"
                autoHeight
                autoFocus
                value={this.state.input}
                onChange={this.changeInput}
              />
            </Card.Content>
            <Card.Content extra>
              {[
                { content: 'Save', color: 'green', icon: 'write', type: 'submit' },
                { content: 'Reset', color: 'yellow', icon: 'repeat', type: 'reset' },
              ].map(e => <Button key={e.content} size="tiny" {...e} />)}
            </Card.Content>
          </Card>
        </div>
      </Form>
    )
  }
}

export default NewList
