import React, { Component, PropTypes } from 'react'
import {
  Button,
  Card,
  Form,
  TextArea,
} from 'semantic-ui-react'
import request from 'superagent'

class NewList extends Component {
  static propTypes = {
    match: PropTypes.shape({
      params: PropTypes.shape({
        id: PropTypes.string.isRequired,
      }).isRequired,
    }).isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {
      data: {
        list: '',
      },
    }
  }

  save = e => {
    e.preventDefault()
    const list = document.getElementById('markdown_textarea').value
    request.post('/api/v1/list') // FIXME: use fetch()
      .send(`list=${list}`)
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
              <TextThing input={this.state.data.list} />
            </Card.Content>
            <Card.Content extra>
              {[
                { content: 'Save', color: 'green', icon: 'write', type: 'submit' },
                { content: 'Reset', color: 'yellow', icon: 'repeat', type: 'reset' },
              ].map(e =>
                <Button key={e.content} size="tiny" {...e} />
              )}
            </Card.Content>
          </Card>
        </div>
      </Form>
    )
  }
}

class TextThing extends Component { // eslint-disable-line react/no-multi-comp
  static propTypes = {
    input: PropTypes.string.isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {
      input: this.props.input,
    }
  }

  update = e => {
    this.setState({ input: e.target.value })
  }

  render() {
    return (
      <TextArea
        id="markdown_textarea"
        autoHeight
        autoFocus
        value={this.state.input}
        onChange={this.update}
      />
    )
  }
}

export default NewList
