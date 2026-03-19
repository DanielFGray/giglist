// @flow
import React, { Component } from 'react'
import {
  Button,
  Card,
  Form,
  TextArea,
} from 'semantic-ui-react'

class Editor extends Component {
  props: {
    match: {
      params: {
        id: string,
      },
    },
  }

  state = {
    data: {},
    input: '',
    saved: false,
    deleted: false,
  }

  componentDidMount() {
    fetch(`/api/v1/list/${this.props.match.params.id}`)
      .then(x => x.json())
      .then(x => x.body)
      .then(data => this.setState({ data, input: data.list }))
  }

  update = (e: SyntheticInputEvent) =>
    this.setState({ input: e.target.value })

  save = (e: SyntheticEvent) => {
    e.preventDefault()
    fetch(`/api/v1/list/${this.props.match.params.id}`, {
      method: 'PUT',
      body: (new FormData()).append('list', this.state.input),
    })
      .then(() => this.setState({ saved: true }))
  }

  delete = (e: SyntheticEvent) => {
    e.preventDefault()
    fetch(`/api/v1/list/${this.props.match.params.id}`, { method: 'DELETE' })
      .then(() => this.setState({ deleted: true }))
  }

  render() {
    if (this.state.saved) {
      return <Redirect to={`/view/${this.props.match.params.id}`} />
    } else if (this.state.deleted) {
      return <Redirect to="/" />
    }
    return (
      <Form action={`/api/v1/list/${this.props.match.params.id}`} method="PUT" onSubmit={this.save}>
        <div style={{ padding: '10px' }}>
          <Card fluid>
            <Card.Header>
              <h1 style={{ padding: '3px 15px' }}>Edit</h1>
            </Card.Header>
            <Card.Content>
              {this.state.input ?
                <TextArea
                  id="markdown_textarea"
                  autoHeight
                  autoFocus
                  value={this.state.input}
                  onChange={this.update}
                />
              : 'Loading...'}
            </Card.Content>
            <Card.Content extra>
              {[
                { content: 'Save', color: 'green', icon: 'write', type: 'submit' },
                { content: 'Reset', color: 'yellow', icon: 'repeat', type: 'reset' },
                { content: 'Delete', color: 'red', icon: 'remove', onClick: this.delete },
              ].map(e =>
                <Button
                  key={e.content}
                  size="tiny"
                  {...e}
                />)}
            </Card.Content>
          </Card>
        </div>
      </Form>
    )
  }
}

export default Editor
